import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type * as ExpoAudio from 'expo-audio';
// Types only: the library itself loads with the first call (voiceRuntime).
import type * as LiveKit from 'livekit-client';
import { startVoiceSession, endVoiceSession, type VoiceSessionResponse } from '../api';
import { ApiError, NetworkError, isNetworkError, limitMessage } from '../api/client';
import { withSystemPrompt } from '../components/PrivacyShield';
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

// ── LiveKit runtime ──────────────────────────────────────────────────────
// livekit-client (with its protocol tables and polyfills) and WebRTC are set
// up when the first call needs them, not at launch: most launches never make
// a call, and registerGlobals() builds WebRTC's peer connection factory on the
// JS thread. registerGlobals() has to run before livekit-client is used, and
// @livekit/react-native installs its own polyfills before it loads
// livekit-client, so it is required first.
//
// @livekit/react-native is a native module absent from Expo Go, where this
// returns null: voice is unavailable there, text chat still works.
type LiveKitClient = typeof LiveKit;

let liveKit: LiveKitClient | null | undefined;

export function voiceRuntime(): LiveKitClient | null {
  if (liveKit !== undefined) return liveKit;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('@livekit/react-native') as { registerGlobals: () => void }).registerGlobals();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    liveKit = require('livekit-client') as LiveKitClient;
  } catch {
    liveKit = null;
  }
  return liveKit;
}

// Lazily too; the call path asks for it only after voiceRuntime(). In Expo
// Go this returns a no-op stub.
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
    // A system alert: the privacy cover must not hide the call screen that
    // explains it.
    return micStatusOf(await withSystemPrompt(() => audio.requestRecordingPermissionsAsync()));
  } catch {
    return 'unknown';
  }
}

/** A status that lets the call go ahead. With the answer unknown, LiveKit asks
 *  as it opens the microphone. */
const micAllowsCall = (s: MicStatus) => s === 'granted' || s === 'unknown';

// ── Server session ───────────────────────────────────────────────────────
interface StartedSession {
  res: VoiceSessionResponse;
  /** When the server started it, which is when billing starts. */
  at: number;
}

const startSession = (characterId: string): Promise<StartedSession> =>
  startVoiceSession(characterId).then(res => ({ res, at: Date.now() }));

// ── Head start ───────────────────────────────────────────────────────────
// The router calls prepareVoiceCall() as it pushes the call screen, so the
// microphone check and the session request are already out while the screen
// renders and slides in. The screen's hook takes both over.
interface HeadStart {
  characterId: string;
  mic: Promise<MicStatus>;
  /** Only started when the microphone lets the call go ahead. */
  session: Promise<StartedSession | null>;
  timer: ReturnType<typeof setTimeout>;
}

let headStart: HeadStart | null = null;

/** A head start nobody has claimed by now belongs to a screen that never came. */
const HEAD_START_TTL_MS = 5000;

function closeHeadStart(h: HeadStart): void {
  clearTimeout(h.timer);
  // Opened for nobody: close it, or it stays open (and billed) until the
  // stale-session sweep.
  h.session.then(s => { if (s) endVoiceSession(s.res.session_id).catch(() => {}); }, () => {});
}

/**
 * Starts a call's first steps for `characterId` ahead of its screen: the
 * microphone check and, when that allows the call, the server session. Call
 * it right before pushing the call screen, whose useVoiceCall takes them
 * over; if none does, the session is closed again.
 */
export function prepareVoiceCall(characterId: string): void {
  if (headStart) closeHeadStart(headStart);
  const mic = micStatus();
  const session = mic.then(s => (micAllowsCall(s) ? startSession(characterId) : null));
  // Observed by the hook that claims it; this only keeps an unclaimed failure quiet.
  session.catch(() => {});
  const h: HeadStart = {
    characterId,
    mic,
    session,
    timer: setTimeout(() => {
      if (headStart !== h) return;
      headStart = null;
      closeHeadStart(h);
    }, HEAD_START_TTL_MS),
  };
  headStart = h;
}

function takeHeadStart(characterId: string | undefined): HeadStart | null {
  const h = headStart;
  headStart = null;
  if (!h) return null;
  clearTimeout(h.timer);
  if (h.characterId === characterId) return h;
  closeHeadStart(h);
  return null;
}

// ── Call server address ──────────────────────────────────────────────────
// Remembered from the last call, so the next one can look the server up
// while its session request is still out.
const LIVEKIT_URL_KEY = 'evarna_livekit_url';
let livekitUrl: Promise<string | null> | null = null;

function knownLivekitUrl(): Promise<string | null> {
  if (!livekitUrl) livekitUrl = AsyncStorage.getItem(LIVEKIT_URL_KEY).catch(() => null);
  return livekitUrl;
}

function rememberLivekitUrl(url: string): void {
  void knownLivekitUrl().then(known => {
    if (known === url) return;
    livekitUrl = Promise.resolve(url);
    AsyncStorage.setItem(LIVEKIT_URL_KEY, url).catch(() => {});
  });
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
  // by the permission itself — never by matching words in the message. Only
  // an error from LiveKit can name it, so LiveKit isn't loaded just to ask.
  const lk = liveKit ?? null;
  if ((lk && lk.MediaDeviceFailure.getFailure(e) === lk.MediaDeviceFailure.PermissionDenied) || (await micStatus()) === 'denied') {
    return { kind: 'mic-permission' };
  }
  return { kind: 'connect' };
}

function errorForDisconnect(lk: LiveKitClient, reason?: LiveKit.DisconnectReason): CallError {
  // The only room the server deletes mid-call is one that reached the daily
  // voice ceiling, right after the companion says goodbye (voice.service.ts).
  // Everything else that ends a room under us is a dropped call.
  return reason === lk.DisconnectReason.ROOM_DELETED ? { kind: 'daily-limit' } : { kind: 'lost' };
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
  agentTrack: LiveKit.RemoteAudioTrack | null;
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
//
// Setup is as parallel as its steps allow, because every step of it is time
// between tapping Call and hearing the companion. After the microphone check,
// the session request, the audio session, LiveKit itself and the room start
// together; the microphone opens while the room connects.
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
  const [agentTrack, setAgentTrack] = useState<LiveKit.RemoteAudioTrack | null>(null);
  const [billedEarlier, setBilledEarlier] = useState(0);
  const [micReady, setMicReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const roomRef = useRef<LiveKit.Room | null>(null);
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

    // Only the first attempt after the push finds one; retries start afresh.
    const head = takeHeadStart(characterId);
    if (!userId || !characterId) {
      if (head) closeHeadStart(head);
      setError({ kind: 'unavailable' });
      setPhase('error');
      return;
    }
    setPhase('connecting');

    let room: LiveKit.Room | null = null;
    // The microphone, from when it is opened until the room has published it.
    let micTracks: Promise<LiveKit.LocalTrack[]> | null = null;
    let micPublished = false;
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

    // Set once this attempt has asked for the audio session.
    let audioAsked = false;
    // The audio session is shared by every attempt. Stop it unless a newer
    // attempt is already live and relying on it, or this one never started
    // it (which would load LiveKit just to stop nothing).
    const releaseAudio = () => {
      if (!audioAsked) return;
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
      // Opened for a room that never got it: disconnecting won't close it.
      const unpublishedMic = micPublished ? null : micTracks;
      closing = (async () => {
        if (r) await r.disconnect().catch(() => {});
        if (unpublishedMic) unpublishedMic.then(tracks => tracks.forEach(t => t.stop()), () => {});
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

    // Takes a server session over once it exists. One that arrives after this
    // attempt was left (hung up while the server was starting it) is closed at
    // once, or it stays open (and billed) until the stale-session sweep.
    const claim = (started: Promise<StartedSession | null>): Promise<VoiceSessionResponse | null> =>
      started.then(s => {
        if (!s) return null;
        if (run.cancelled) {
          endVoiceSession(s.res.session_id).catch(() => {});
          return null;
        }
        sessionId = s.res.session_id;
        billedAt = s.at;
        setBilledSince(s.at);
        return s.res;
      });
    // Claimed at once, so a head start is closed even if this attempt is left
    // before it gets that far.
    const headSession = head ? claim(head.session) : null;
    headSession?.catch(() => {});

    (async () => {
      try {
        const mic = await (head ? head.mic : micStatus());
        if (run.cancelled) return;
        if (mic === 'ask') {
          setPhase('permission');
          return;
        }
        if (mic === 'denied') {
          fail({ kind: 'mic-permission' });
          return;
        }

        // None of these waits for another: the session request, LiveKit
        // itself (set up on the JS thread while the request is out), the
        // audio session (activated on its own native queue) and the room.
        const session = headSession ?? claim(startSession(characterId));
        session.catch(() => {});
        const lk = voiceRuntime();
        if (!lk) {
          fail({ kind: 'unavailable' });
          return;
        }
        audioAsked = true;
        const audioReady = getAudioSession().startAudioSession().then(() => {
          // abandon() may have released the session before it had started.
          if (run.cancelled) releaseAudio();
        });

        const r = new lk.Room();
        room = r;
        roomRef.current = r;
        // Looks the call server up (DNS) while the session request is out.
        void knownLivekitUrl().then(url => {
          if (url && !run.cancelled) void r.prepareConnection(url);
        });

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
          .on(lk.RoomEvent.Connected, () => {
            if (run.cancelled) return;
            roomUp = true;
            if (r.remoteParticipants.size > 0) companionJoined();
            else waitForCompanion();
          })
          .on(lk.RoomEvent.ParticipantConnected, companionJoined)
          .on(lk.RoomEvent.ParticipantDisconnected, () => {
            if (run.cancelled || reconnecting || r.remoteParticipants.size > 0) return;
            companionMayHaveLeft();
          })
          .on(lk.RoomEvent.Reconnecting, () => {
            if (run.cancelled) return;
            reconnecting = true;
            // The unwinding just before this armed the companion-left timer.
            // LiveKit is recovering the room; let it.
            clearTimeout(joinTimer);
            clearTimeout(leftTimer);
            setPhase('reconnecting');
          })
          .on(lk.RoomEvent.Reconnected, () => {
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
          .on(lk.RoomEvent.Disconnected, (reason?: LiveKit.DisconnectReason) => {
            if (!roomUp) return;
            // Our own hang-up or teardown has already cancelled the attempt.
            fail(errorForDisconnect(lk, reason));
          })
          .on(lk.RoomEvent.TrackSubscribed, (track: LiveKit.RemoteTrack) => {
            if (!run.cancelled && track.kind === lk.Track.Kind.Audio) setAgentTrack(track as LiveKit.RemoteAudioTrack);
          })
          .on(lk.RoomEvent.TrackUnsubscribed, (track: LiveKit.RemoteTrack) => {
            setAgentTrack(current => (current === track ? null : current));
          })
          .on(lk.RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
            if (run.cancelled || (topic && topic !== 'ui')) return;
            const next = decodeAgentState(payload);
            if (!next) return;
            // The backend reports the real pipeline state. Once it has spoken,
            // the speaker-list guess below stands down for the rest of the call.
            hintSeen = true;
            settler.propose(next);
          })
          .on(lk.RoomEvent.ActiveSpeakersChanged, (speakers: LiveKit.Participant[]) => {
            if (run.cancelled || hintSeen) return;
            const me = r.localParticipant.identity;
            settler.propose(orbFromSpeakers(speakers.some(s => s.identity !== me)));
          });

        const [res] = await Promise.all([session, audioReady]);
        // No session only when this attempt was left while it was starting.
        if (run.cancelled || !res) return;
        rememberLivekitUrl(res.livekit_url);

        // The microphone opens while the room connects, and is published once
        // it is up. The same track setMicrophoneEnabled(true) would make
        // (the room's capture defaults, source Microphone), so Mute and the
        // reconnect handling above treat it exactly the same.
        micTracks = r.localParticipant.createTracks({ audio: true });
        micTracks.catch(() => {});
        await r.connect(res.livekit_url, res.livekit_token);
        if (run.cancelled) return;
        const [track] = await micTracks;
        if (run.cancelled) return;
        if (track) {
          await r.localParticipant.publishTrack(track);
          micPublished = true;
        }
        if (run.cancelled) return;
        // Mute pressed before the microphone was published still counts.
        if (mutedRef.current) r.localParticipant.setMicrophoneEnabled(false).catch(() => {});
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
