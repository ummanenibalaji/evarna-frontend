import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, type RemoteParticipant } from 'livekit-client';

// @livekit/react-native is a native module absent from Expo Go; importing it at
// module scope crashes the app on launch (this hook is reachable from the Chat
// screen, which loads eagerly). Resolve it lazily so it's only touched when a
// voice call actually starts. In Expo Go this returns a no-op stub — text chat
// works, and voice is simply inert until run in a dev/production build.
function getAudioSession(): {
  startAudioSession: () => Promise<void>;
  stopAudioSession: () => Promise<void>;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@livekit/react-native').AudioSession;
  } catch {
    return { startAudioSession: async () => {}, stopAudioSession: async () => {} };
  }
}
import { startVoiceSession, endVoiceSession } from '../api';
import { limitMessage } from '../api/client';
import { quotaCode } from '../lib/entitlement';
import { startCallService, stopCallService } from '../lib/callService';
import {
  AGENT_JOIN_TIMEOUT_MS,
  decodeAgentState,
  type CallError,
  type CallPhase,
  type OrbState,
} from '../lib/voiceCall';

/** The backend's user-facing sentence, when it sent one. */
const serverMessageOf = (e: unknown): string | undefined => {
  const m = (e as { serverMessage?: unknown } | null)?.serverMessage;
  return typeof m === 'string' && m.length > 0 ? m : undefined;
};

interface UseVoiceCallParams {
  userId?: string;
  characterId?: string;
  enabled: boolean;
  onEnded?: () => void;
  /** Shown in Android's ongoing call notification. */
  callTitle?: string;
}

interface UseVoiceCallReturn {
  phase: CallPhase;
  orbState: OrbState;
  muted: boolean;
  error: CallError | null;
  toggleMute: () => void;
  hangUp: () => Promise<void>;
  retry: () => void;
}

// Real LiveKit-driven voice call. Fetches a session token from the backend,
// joins the Room, publishes the mic, and drives orb state from the backend's
// "ui" DataChannel topic (falling back to ActiveSpeakersChanged when no hint
// arrives). Mute hits the real mic; hangUp tears down the Room + audio session.
export function useVoiceCall(params: UseVoiceCallParams): UseVoiceCallReturn {
  const { userId, characterId, enabled, onEnded, callTitle } = params;
  const callTitleRef = useRef(callTitle);
  callTitleRef.current = callTitle;

  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [orbState, setOrbState] = useState<OrbState>('thinking');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<CallError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const cancelledRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  // The backend now closes the session itself when the participant leaves the
  // LiveKit room, but we also tell it explicitly on hang-up. Belt and braces:
  // covers the case where the voice worker is down, so nothing server-side is
  // watching the room. The endpoint is idempotent, so a double call is safe.
  const sessionIdRef = useRef<string | null>(null);

  const finalizeSession = useCallback(() => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) endVoiceSession(sid).catch(() => { /* fire and forget */ });
  }, []);

  // Skip the live connection unless we have real ids; the screen still mounts
  // (e.g. demo path) so we just sit in "connecting" forever in that case —
  // callers should pass enabled=false when they want the screen demoed.
  const shouldConnect = enabled && !!userId && !!characterId;

  useEffect(() => {
    if (!shouldConnect) return;

    cancelledRef.current = false;
    setPhase('connecting');
    setOrbState('thinking');
    setError(null);

    let room: Room | null = null;
    let agentJoinTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const res = await startVoiceSession(characterId!);
        sessionIdRef.current = res.session_id;
        if (cancelledRef.current) return;

        await getAudioSession().startAudioSession();

        room = new Room();
        roomRef.current = room;

        room
          .on(RoomEvent.Connected, () => {
            if (cancelledRef.current) return;
            setPhase('connected');
            // Wait for the agent participant; if it doesn't show up, surface an error.
            agentJoinTimer = setTimeout(() => {
              if (cancelledRef.current || !room) return;
              const hasRemote = room.remoteParticipants.size > 0;
              if (!hasRemote) {
                setError({ kind: 'agent-timeout', message: "Your companion didn't pick up. The voice worker may be offline." });
                setPhase('error');
              }
            }, AGENT_JOIN_TIMEOUT_MS);
          })
          .on(RoomEvent.Reconnecting, () => {
            if (cancelledRef.current) return;
            setPhase('reconnecting');
          })
          .on(RoomEvent.Reconnected, () => {
            if (cancelledRef.current) return;
            setPhase('connected');
          })
          .on(RoomEvent.Disconnected, () => {
            stopCallService();
            if (cancelledRef.current) return;
            setPhase('ended');
            onEndedRef.current?.();
          })
          .on(RoomEvent.ParticipantConnected, () => {
            if (agentJoinTimer) {
              clearTimeout(agentJoinTimer);
              agentJoinTimer = null;
            }
          })
          .on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
            if (cancelledRef.current) return;
            if (topic && topic !== 'ui') return;
            const next = decodeAgentState(payload);
            if (next) setOrbState(next);
          })
          .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            if (cancelledRef.current || !room) return;
            const localId = room.localParticipant.identity;
            const agentSpeaking = speakers.some(s => s.identity !== localId);
            const userSpeaking = speakers.some(s => s.identity === localId);
            // Only nudge orb state when the backend hasn't published an explicit hint.
            // (DataReceived above takes precedence.)
            if (agentSpeaking) setOrbState('speaking');
            else if (userSpeaking) setOrbState('listening');
            else setOrbState('thinking');
          });

        await room.connect(res.livekit_url, res.livekit_token);
        if (cancelledRef.current) return;
        await room.localParticipant.setMicrophoneEnabled(true);
        // Only now: Android allows a microphone service once the mic permission
        // is granted, and only while the app is on screen.
        if (!cancelledRef.current) startCallService(callTitleRef.current ?? 'your companion');
      } catch (e) {
        if (cancelledRef.current) return;

        // The server's own refusals first. This catch covers five awaits, and
        // classifying by message alone sent a 402 "you have no minutes left"
        // down the network-error path — the user was told to check their
        // connection and offered a retry that could only fail again.
        //
        // Two layers, because they need different offers. The plan being spent
        // is worth offering plans; an abuse ceiling is not — no purchase lifts it.
        if (quotaCode(e) === 'VOICE_MINUTES_EXHAUSTED') {
          setError({
            kind: 'quota-exhausted',
            message: serverMessageOf(e) ?? "You've used all your voice minutes for this month.",
          });
          setPhase('error');
          return;
        }

        const limit = limitMessage(e);
        if (limit) {
          // Concurrency is the one ceiling a retry fixes, so it gets its own
          // kind and keeps the Try again button. usage.service.ts owns the rule
          // and names it in `limit`.
          const concurrent = (e as { limit?: unknown } | null)?.limit === 'concurrent_calls';
          setError({ kind: concurrent ? 'call-in-progress' : 'limit', message: limit });
          setPhase('error');
          return;
        }

        const msg = e instanceof Error ? e.message : String(e);
        // Mic permission errors typically come from setMicrophoneEnabled or
        // AudioSession; everything else is more likely token/network/connect.
        const isMic = /permission|denied|microphone/i.test(msg);
        setError({
          kind: isMic ? 'mic-permission' : 'connect',
          message: isMic
            ? 'Evarna needs microphone access to make a call. Enable it in Settings.'
            : "Couldn't connect to the voice service. Check your connection and try again.",
        });
        setPhase('error');
      }
    })();

    return () => {
      cancelledRef.current = true;
      stopCallService();
      if (agentJoinTimer) clearTimeout(agentJoinTimer);
      const r = roomRef.current;
      roomRef.current = null;
      if (r) r.disconnect().catch(() => {});
      getAudioSession().stopAudioSession().catch(() => {});
      // Covers navigating away / unmount without pressing hang up.
      finalizeSession();
    };
  }, [shouldConnect, userId, characterId, attempt, finalizeSession]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      roomRef.current?.localParticipant.setMicrophoneEnabled(!next).catch(() => {});
      return next;
    });
  }, []);

  const hangUp = useCallback(async () => {
    const r = roomRef.current;
    roomRef.current = null;
    cancelledRef.current = true;
    if (r) {
      try { await r.disconnect(); } catch { /* swallow */ }
    }
    try { await getAudioSession().stopAudioSession(); } catch { /* swallow */ }
    stopCallService();
    finalizeSession();
    setPhase('ended');
  }, [finalizeSession]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt(a => a + 1);
  }, []);

  return useMemo(
    () => ({ phase, orbState, muted, error, toggleMute, hangUp, retry }),
    [phase, orbState, muted, error, toggleMute, hangUp, retry],
  );
}
