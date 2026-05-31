// Helpers shared by the voice call hook.
// Kept in a separate file so the hook stays focused on lifecycle.

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Maps the backend orb hint to the local Orb component's state enum.
// 'memory' is a frontend-only transient and is not driven by the backend.
export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'memory';

export type CallPhase =
  | 'connecting'   // fetching token / connecting socket
  | 'connected'    // room joined + (eventually) agent participant present
  | 'reconnecting' // transient network drop, LiveKit auto-recovers
  | 'ended'        // hangup or remote disconnect
  | 'error';       // unrecoverable; surface CTA to the user

export type CallErrorKind =
  | 'mic-permission'
  | 'token-fetch'
  | 'connect'
  | 'agent-timeout'
  | 'lost';

export interface CallError {
  kind: CallErrorKind;
  message: string;
}

// Backend agent-state messages arrive on DataChannel topic "ui":
//   { kind: "agent_state", state: "listening" | "thinking" | "speaking" | "idle" }
interface AgentStatePayload {
  kind: 'agent_state';
  state: AgentState;
}

export function decodeAgentState(payload: Uint8Array): AgentState | null {
  try {
    const text = new TextDecoder().decode(payload);
    const json = JSON.parse(text) as Partial<AgentStatePayload>;
    if (json.kind !== 'agent_state') return null;
    const s = json.state;
    if (s === 'idle' || s === 'listening' || s === 'thinking' || s === 'speaking') return s;
    return null;
  } catch {
    return null;
  }
}

// 8s after Room.connect — if no remote participant is present, the worker
// is likely down. Surface a recoverable error rather than leaving the orb
// spinning forever.
export const AGENT_JOIN_TIMEOUT_MS = 8000;
