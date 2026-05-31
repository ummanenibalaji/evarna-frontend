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
import { startVoiceSession } from '../api';
import {
  AGENT_JOIN_TIMEOUT_MS,
  decodeAgentState,
  type CallError,
  type CallPhase,
  type OrbState,
} from '../lib/voiceCall';

interface UseVoiceCallParams {
  userId?: string;
  characterId?: string;
  enabled: boolean;
  onEnded?: () => void;
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
  const { userId, characterId, enabled, onEnded } = params;

  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [orbState, setOrbState] = useState<OrbState>('thinking');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<CallError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const cancelledRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

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
        const res = await startVoiceSession(userId!, characterId!);
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
      } catch (e) {
        if (cancelledRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Mic permission errors typically come from setMicrophoneEnabled or
        // AudioSession; everything else is more likely token/network/connect.
        const isMic = /permission|denied|microphone/i.test(msg);
        setError({
          kind: isMic ? 'mic-permission' : 'connect',
          message: isMic
            ? 'Whisper needs microphone access to make a call. Enable it in Settings.'
            : "Couldn't connect to the voice service. Check your connection and try again.",
        });
        setPhase('error');
      }
    })();

    return () => {
      cancelledRef.current = true;
      if (agentJoinTimer) clearTimeout(agentJoinTimer);
      const r = roomRef.current;
      roomRef.current = null;
      if (r) r.disconnect().catch(() => {});
      getAudioSession().stopAudioSession().catch(() => {});
    };
  }, [shouldConnect, userId, characterId, attempt]);

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
    setPhase('ended');
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setAttempt(a => a + 1);
  }, []);

  return useMemo(
    () => ({ phase, orbState, muted, error, toggleMute, hangUp, retry }),
    [phase, orbState, muted, error, toggleMute, hangUp, retry],
  );
}
