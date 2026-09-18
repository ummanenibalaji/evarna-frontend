import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type * as ExpoAudio from 'expo-audio';
import {
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteAudioTrack,
  type RemoteTrack,
} from 'livekit-client';
import { startVoiceSession, endVoiceSession } from '../api';
import { ApiError, NetworkError, isNetworkError, limitMessage } from '../api/client';
import { quotaCode } from '../lib/entitlement';
import { startCallService, stopCallService } from '../lib/callService';
import {
  AGENT_JOIN_TIMEOUT_MS,
  AGENT_LEFT_GRACE_MS,
  createOrbSettler,
  decodeAgentState,
  orbFromSpeakers,
  type CallError,
  type CallPhase,
  type OrbState,
} from '../lib/voiceCall';

interface LiveKitAudio {
  startAudioSession(): Promise<void>;
  stopAudioSession(): Promise<void>;
  getAudioOutputs(): Promise<string[]>;
  selectAudioOutput(deviceId: string): Promise<void>;
  showAudioRoutePicker(): Promise<void>;
}

const NO_AUDIO: LiveKitAudio = {
  startAudioSession: async () => {},
  stopAudioSession: async () => {},
  getAudioOutputs: async () => [],
  selectAudioOutput: async () => {},
  showAudioRoutePicker: async () => {},
};

// @livekit/react-native is a native module absent from Expo Go; importing it at
// module scope crashes the app on launch (this hook is reachable from screens
// that load eagerly). Resolve it lazily so it's only touched when a voice call
// actually starts. In Expo Go this returns a no-op stub — text chat works, and
// voice is simply inert until run in a dev/production build.
function getAudioSession(): LiveKitAudio {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@livekit/react-native').AudioSession as LiveKitAudio;
  } catch {
    return NO_AUDIO;
  }
}

// ── Microphone permission ────────────────────────────────────────────────
// Read through expo-audio (lazily, like voicePreview.ts) so the app knows the
// answer before it starts a billed session, instead of finding out from
// LiveKit's error halfway through connecting.
type MicStatus = 'granted' | 'ask' | 'denied' | 'unknown';

let expoAudio: typeof ExpoAudio | null | undefined;
function audioModule(): typeof ExpoAudio | null {
  if (expoAudio === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      expoAudio = require('expo-audio') as typeof ExpoAudio;
    } catch {
      expoAudio = null;
    }
  }
  return expoAudio;
}

const micStatusOf = (p: { granted: boolean; canAskAgain: boolean }): MicStatus =>
  p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'denied';

/** The permission as it stands, without prompting. 'ask' means a prompt can still be shown. */
async function micStatus(): Promise<MicStatus> {
  const audio = audioModule();
  if (!audio) return 'unknown';
  try {
    return micStatusOf(await audio.getRecordingPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

async function askForMic(): Promise<MicStatus> {
  const audio = audioModule();
  if (!audio) return 'unknown';
  try {
    return micStatusOf(await audio.requestRecordingPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

// ── Audio output ─────────────────────────────────────────────────────────
/** Where call audio plays. iOS has a system route picker; Android lists its outputs. */
export const callAudioOutput = {
  /** iOS: shows the system picker (iPhone, speaker, AirPods…). False where there is none. */
  async showPicker(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    const session = getAudioSession();
    if (session === NO_AUDIO) return false;
    try {
      await session.showAudioRoutePicker();
      return true;
    } catch {
      return false;
    }
  },
  /** Android: 'speaker' | 'earpiece' | 'headset' | 'bluetooth', whichever are present. */
  async list(): Promise<string[]> {
    try {
      return await getAudioSession().getAudioOutputs();
    } catch {
      return [];
    }
  },
  async select(id: string): Promise<boolean> {
    try {
      await getAudioSession().selectAudioOutput(id);
      return true;
    } catch {
      return false;
    }
  },
};

// ── Errors ───────────────────────────────────────────────────────────────
/** The backend's user-facing sentence, when it sent one. */
const serverMessageOf = (e: unknown): string | undefined => {
  const m = (e as { serverMessage?: unknown } | null)?.serverMessage;
  return typeof m === 'string' && m.length > 0 ? m : undefined;
};

async function errorFor(e: unknown): Promise<CallError> {
  // The server's own refusals first. This covers every await of the start, and
  // classifying by message alone sent a 402 "you have no minutes left" down the
  // network-error path — the user was told to check their connection and
  // offered a retry that could only fail again.
  //
  // Two layers, because they need different offers. The plan being spent is
  // worth offering plans; an abuse ceiling is not — no purchase lifts it.
  const quota = quotaCode(e);
  if (quota === 'VOICE_MINUTES_EXHAUSTED') return { kind: 'quota-exhausted', message: serverMessageOf(e) };
  if (quota === 'CALL_IN_PROGRESS') return { kind: 'call-in-progress', message: serverMessageOf(e) };

  const limit = limitMessage(e);
  if (limit) {
    // Concurrency is the one ceiling a retry fixes, so it gets its own kind
    // and keeps the Try again button. usage.service.ts owns the rule and names
    // it in `limit`.
    const concurrent = (e as { limit?: unknown } | null)?.limit === 'concurrent_calls';
    return { kind: concurrent ? 'call-in-progress' : 'limit', message: limit };
  }
  // A generic rate limiter's message is written for developers, so only its
  // wait is kept.
  if (e instanceof ApiError && e.status === 429) return { kind: 'rate-limited', retryAfter: e.retryAfter };
  // The client's own timeout only says the server was slow to answer (a cold
  // start, a slow room), not that this phone is offline.
  if (e instanceof NetworkError && e.timedOut) return { kind: 'connect' };
  if (isNetworkError(e)) return { kind: 'offline' };
  // A refused microphone, told apart by the error's name (NotAllowedError) or
  // by the permission itself — never by matching words in the message.
  if (MediaDeviceFailure.getFailure(e) === MediaDeviceFailure.PermissionDenied || (await micStatus()) === 'denied') {
    return { kind: 'mic-permission' };
  }
  return { kind: 'connect' };
}

function errorForDisconnect(reason?: DisconnectReason): CallError {
  // The only room the server deletes mid-call is one that reached the daily
  // voice ceiling, right after the companion says goodbye (voice.service.ts).
  // Everything else that ends a room under us is a dropped call.
  return reason === DisconnectReason.ROOM_DELETED ? { kind: 'daily-limit' } : { kind: 'lost' };
}

// ── Keep awake ───────────────────────────────────────────────────────────
const KEEP_AWAKE_TAG = 'evarna-voice-call';

function keepAwake(on: boolean): void {
  try {
    (on ? activateKeepAwakeAsync(KEEP_AWAKE_TAG) : deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => {});
  } catch {
    // Module missing from this build: the screen may dim, the call carries on.
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────
interface UseVoiceCallParams {
  userId?: string;
  characterId?: string;
  /** Shown in Android's ongoing call notification. */
  callTitle?: string;
}

export interface VoiceCall {
  phase: CallPhase;
  /** The companion's turn, from the backend (debounced). Meaningful while connected. */
  orbState: OrbState;
  muted: boolean;
  error: CallError | null;
  /** When the companion joined: the start of the conversation, for the call clock. */
  connectedAt: number | null;
  /** When the server session started, which is what the balance is charged from. */
  billedSince: number | null;
  /**
   * Seconds charged by this screen's sessions that have closed: a dropped
   * call, before "Call again". The next call's balance counts on from here.
   */
  billedEarlier: number;
  /** The microphone is published, so Mute has something to act on. */
  micReady: boolean;
  /** When the user hung up. */
  endedAt: number | null;
  /** The companion's voice, for level metering. */
  agentTrack: RemoteAudioTrack | null;
  toggleMute: () => void;
  /** Ends the call; resolves once the room is closed. */
  hangUp: () => Promise<void>;
  retry: () => void;
  /** From the permission step: ask the OS for the microphone, then call. */
  allowMic: () => Promise<void>;
}

/** One try at a call. Retrying starts a new one; anything still in flight
 *  from the old one sees `cancelled` and stops. */
interface Attempt {
  cancelled: boolean;
}

// Real LiveKit-driven voice call. Checks the mic permission, fetches a session
// token from the backend, joins the Room, publishes the mic, and drives the
// orb from the backend's "ui" DataChannel topic (falling back to
// ActiveSpeakersChanged until the first hint arrives). Mute hits the real mic;
// hangUp tears down the Room, the audio session and the server session.
export function useVoiceCall({ userId, characterId, callTitle }: UseVoiceCallParams): VoiceCall {
  const callTitleRef = useRef(callTitle);
  callTitleRef.current = callTitle;

  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [orbState, setOrbState] = useState<OrbState>('thinking');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<CallError | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [billedSince, setBilledSince] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [agentTrack, setAgentTrack] = useState<RemoteAudioTrack | null>(null);
  const [billedEarlier, setBilledEarlier] = useState(0);
  const [micReady, setMicReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const mutedRef = useRef(false);
  const billedEarlierRef = useRef(0);
  const attemptRef = useRef<Attempt | null>(null);
  const abandonRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const run: Attempt = { cancelled: false };
    attemptRef.current = run;

    // Every attempt starts clean. The mute flag especially: a retry after
    // muting used to leave the button saying muted while the new room
    // published a live mic.
    mutedRef.current = false;
    setMuted(false);
    setError(null);
    setConnectedAt(null);
    setBilledSince(null);
    setEndedAt(null);
    setAgentTrack(null);
    setMicReady(false);
    setOrbState('thinking');

    if (!userId || !characterId) {
      setError({ kind: 'unavailable' });
      setPhase('error');
      return;
    }
    setPhase('connecting');

    let room: Room | null = null;
    // Per attempt, so closing an old attempt can never end a newer one's session.
    let sessionId: string | null = null;
    // When this attempt's session started charging; null once it has closed.
    let billedAt: number | null = null;
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    let leftTimer: ReturnType<typeof setTimeout> | undefined;
    let hintSeen = false;
    let hasJoined = false;
    const settler = createOrbSettler('thinking', next => {
      if (!run.cancelled) setOrbState(next);
    });

    // The audio session is shared by every attempt. Stop it unless a newer
    // attempt is already live and relying on it.
    const releaseAudio = () => {
      const current = attemptRef.current;
      if (current && current !== run && !current.cancelled) return;
      getAudioSession().stopAudioSession().catch(() => {});
    };

    // Leave this attempt: stop listening to it, close the room, release the
    // audio session and end the server session. Safe to call more than once.
    let closing: Promise<void> | null = null;
    const abandon = (): Promise<void> => {
      if (closing) return closing;
      run.cancelled = true;
      clearTimeout(joinTimer);
      clearTimeout(leftTimer);
      settler.dispose();
      stopCallService();
      const r = room;
      room = null;
      if (roomRef.current === r) roomRef.current = null;
      const sid = sessionId;
      sessionId = null;
      if (billedAt != null) {
        billedEarlierRef.current += Math.max(0, Date.now() - billedAt) / 1000;
        billedAt = null;
        setBilledEarlier(billedEarlierRef.current);
      }
      closing = (async () => {
        if (r) await r.disconnect().catch(() => {});
        releaseAudio();
        // The backend also closes the session when the participant leaves the
        // room, but that needs the voice worker to be up. The endpoint is
        // idempotent, so saying so explicitly is safe.
        if (sid) endVoiceSession(sid).catch(() => {});
      })();
      return closing;
    };
    abandonRef.current = abandon;

    // Every failure closes the call before it shows. An error screen over a
    // live room kept billing, and a companion joining late talked over it.
    const fail = (e: CallError) => {
      if (run.cancelled) return;
      void abandon();
      setAgentTrack(null);
      setError(e);
      setPhase('error');
    };

    const companionJoined = () => {
      if (run.cancelled) return;
      hasJoined = true;
      clearTimeout(joinTimer);
      clearTimeout(leftTimer);
      // The clock starts when the companion picks up, not when the room opens.
      setConnectedAt(at => at ?? Date.now());
      setPhase('connected');
    };

    (async () => {
      try {
        const mic = await micStatus();
        if (run.cancelled) return;
        if (mic === 'ask') {
          setPhase('permission');
          return;
        }
        if (mic === 'denied') {
          fail({ kind: 'mic-permission' });
          return;
        }

        const res = await startVoiceSession(characterId);
        if (run.cancelled) {
          // Hung up while the server was starting it: close it now, or it stays
          // open (and billed) until the stale-session sweep.
          endVoiceSession(res.session_id).catch(() => {});
          return;
        }
        sessionId = res.session_id;
        billedAt = Date.now();
        setBilledSince(billedAt);

        await getAudioSession().startAudioSession();
        if (run.cancelled) {
          // abandon() may have released the session before it had started.
          releaseAudio();
          return;
        }

        const r = new Room();
        room = r;
        roomRef.current = r;

        // Up from the room's Connected event. Before it, a Disconnected is only
        // connect() failing: its rejection reaches errorFor below, which can
        // tell "couldn't connect" from "offline". Handled here, it could only
        // have called a call that never started a dropped one.
        let roomUp = false;
        // From Reconnecting to Reconnected. A full reconnect unwinds every
        // participant just before it says it is reconnecting, and announces
        // them again just after it has reconnected. Neither is the companion
        // leaving or joining, so neither may end the call.
        let reconnecting = false;

        const waitForCompanion = () => {
          clearTimeout(joinTimer);
          joinTimer = setTimeout(() => {
            if (!reconnecting) fail({ kind: 'agent-timeout' });
          }, AGENT_JOIN_TIMEOUT_MS);
        };
        // The companion has gone unless it's back within the grace period. If
        // the room closes in that time, its own disconnect says why.
        const companionMayHaveLeft = () => {
          clearTimeout(leftTimer);
          leftTimer = setTimeout(() => {
            if (reconnecting || r.remoteParticipants.size > 0) return;
            fail({ kind: 'lost' });
          }, AGENT_LEFT_GRACE_MS);
        };

        r
          .on(RoomEvent.Connected, () => {
            if (run.cancelled) return;
            roomUp = true;
            if (r.remoteParticipants.size > 0) companionJoined();
            else waitForCompanion();
          })
          .on(RoomEvent.ParticipantConnected, companionJoined)
          .on(RoomEvent.ParticipantDisconnected, () => {
            if (run.cancelled || reconnecting || r.remoteParticipants.size > 0) return;
            companionMayHaveLeft();
          })
          .on(RoomEvent.Reconnecting, () => {
            if (run.cancelled) return;
            reconnecting = true;
            // The unwinding just before this armed the companion-left timer.
            // LiveKit is recovering the room; let it.
            clearTimeout(joinTimer);
            clearTimeout(leftTimer);
            setPhase('reconnecting');
          })
          .on(RoomEvent.Reconnected, () => {
            if (run.cancelled) return;
            const wasReconnecting = reconnecting;
            reconnecting = false;
            // Muted during the reconnect: the republished mic follows the button.
            if (mutedRef.current) r.localParticipant.setMicrophoneEnabled(false).catch(() => {});
            if (r.remoteParticipants.size > 0) {
              companionJoined();
              return;
            }
            // A quick resume unwinds nothing, and the timers still stand.
            if (!wasReconnecting) return;
            // After a full reconnect the participants it brought back are
            // announced right after this event. Look again once they have been.
            setTimeout(() => {
              if (run.cancelled || reconnecting || r.remoteParticipants.size > 0) return;
              if (hasJoined) {
                companionMayHaveLeft();
              } else {
                setPhase('connecting');
                waitForCompanion();
              }
            }, 0);
          })
          .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
            if (!roomUp) return;
            // Our own hang-up or teardown has already cancelled the attempt.
            fail(errorForDisconnect(reason));
          })
          .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
            if (!run.cancelled && track.kind === Track.Kind.Audio) setAgentTrack(track as RemoteAudioTrack);
          })
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            setAgentTrack(current => (current === track ? null : current));
          })
          .on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
            if (run.cancelled || (topic && topic !== 'ui')) return;
            const next = decodeAgentState(payload);
            if (!next) return;
            // The backend reports the real pipeline state. Once it has spoken,
            // the speaker-list guess below stands down for the rest of the call.
            hintSeen = true;
            settler.propose(next);
          })
          .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
            if (run.cancelled || hintSeen) return;
            const me = r.localParticipant.identity;
            settler.propose(orbFromSpeakers(speakers.some(s => s.identity !== me)));
          });

        await r.connect(res.livekit_url, res.livekit_token);
        if (run.cancelled) return;
        await r.localParticipant.setMicrophoneEnabled(true);
        if (run.cancelled) return;
        // The mic is live from here, companion or not, so Mute works from here.
        setMicReady(true);
        // Only now: Android allows a microphone service once the mic permission
        // is granted, and only while the app is on screen.
        startCallService(callTitleRef.current ?? 'your companion');
      } catch (e) {
        if (run.cancelled) return;
        const failure = await errorFor(e);
        fail(failure);
      }
    })();

    // Covers navigating away / unmount without pressing hang up, and retries.
    return () => {
      void abandon();
    };
  }, [userId, characterId, attempt]);

  // The screen stays on for the whole call; it used to auto-lock mid-sentence.
  const live = phase === 'connecting' || phase === 'connected' || phase === 'reconnecting';
  useEffect(() => {
    if (!live) return;
    keepAwake(true);
    return () => keepAwake(false);
  }, [live]);

  // Back from Settings with the microphone allowed: carry on with the call
  // the user was trying to make.
  const micBlocked = error?.kind === 'mic-permission';
  useEffect(() => {
    if (!micBlocked) return;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      void micStatus().then(s => {
        if (s === 'granted' || s === 'ask') setAttempt(a => a + 1);
      });
    });
    return () => sub.remove();
  }, [micBlocked]);

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    room.localParticipant.setMicrophoneEnabled(!next).catch(() => {
      // The mic didn't follow, so neither does the button.
      if (mutedRef.current !== next) return;
      mutedRef.current = !next;
      setMuted(!next);
    });
  }, []);

  const hangUp = useCallback(async () => {
    setEndedAt(Date.now());
    setPhase('ended');
    await abandonRef.current?.();
  }, []);

  const retry = useCallback(() => {
    setAttempt(a => a + 1);
  }, []);

  const allowMic = useCallback(async () => {
    const status = await askForMic();
    if (status === 'denied') {
      setError({ kind: 'mic-permission' });
      setPhase('error');
      return;
    }
    // Android's "Don't allow" can be asked again, so the explainer stays up.
    if (status === 'ask') return;
    // Granted — or unknown, in which case LiveKit asks when it opens the mic.
    setAttempt(a => a + 1);
  }, []);

  return useMemo(
    () => ({
      phase, orbState, muted, error, connectedAt, billedSince, billedEarlier, endedAt, agentTrack, micReady,
      toggleMute, hangUp, retry, allowMic,
    }),
    [phase, orbState, muted, error, connectedAt, billedSince, billedEarlier, endedAt, agentTrack, micReady, toggleMute, hangUp, retry, allowMic],
  );
}
