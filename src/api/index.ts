import { apiGet, apiPost, apiDelete } from './client';

// ── Onboarding ─────────────────────────────────────────────────────────────

export interface OnboardPayload {
  display_name: string;
  gender: string;
  date_of_birth: string;
  communication_style: string;
  intent: string;
  companion: {
    name: string;
    archetype: string;
    gender: string;
    voice_id: string;
  };
}

export interface OnboardResponse {
  user_id: string;
  character_id: string;
}

export const onboardUser = (p: OnboardPayload): Promise<OnboardResponse> =>
  apiPost<OnboardResponse>('/users/onboard', p);

// ── Characters ─────────────────────────────────────────────────────────────

// Shape returned by GET /characters/user/:user_id. The backend is the source of
// truth for archetype names ("bestfriend" — frontend maps that to "friend").
export interface ApiCharacter {
  _id: string;
  user_id: string;
  name: string;
  archetype: string;
  gender?: string;
  voice_id?: string;
  last_interaction_at?: string;
  last_message_preview?: string | null;
  memory_highlight?: string | null;
  created_at?: string;
}

// Backend returns { characters: [...] } inside ApiResponse.data; unwrap here so
// the consumer just gets the array.
export const getUserCharacters = async (userId: string): Promise<ApiCharacter[]> => {
  const res = await apiGet<{ characters: ApiCharacter[] }>(`/characters/user/${userId}`);
  return res.characters;
};

export interface CreateCharacterPayload {
  user_id: string;
  archetype: string;
  gender: string;
  voice_id: string;
  name: string;
}

export interface CreateCharacterResponse {
  character_id: string;
}

export const createCharacter = (p: CreateCharacterPayload): Promise<CreateCharacterResponse> =>
  apiPost<CreateCharacterResponse>('/characters/create', p);

// ── User stats ─────────────────────────────────────────────────────────────

export interface ApiUserStats {
  total_companions: number;
  total_sessions: number;
  total_voice_minutes: number;
  total_memories: number;
  member_since: string;
}

export const getUserStats = (userId: string): Promise<ApiUserStats> =>
  apiGet<ApiUserStats>(`/users/${userId}/stats`);

// ── Sessions ───────────────────────────────────────────────────────────────

export const startSession = (
  userId: string,
  characterId: string,
  sessionType: 'text' | 'voice' = 'text',
): Promise<{ session_id: string }> =>
  apiPost('/sessions/start', { user_id: userId, character_id: characterId, session_type: sessionType });

export const endSession = (sessionId: string): Promise<unknown> =>
  apiPost(`/sessions/${sessionId}/end`, {});

export interface ApiSession {
  _id: string;
  character_id: string;
  session_type: string;
  started_at: string;
}

export interface ApiTurn {
  _id: string;
  role: 'user' | 'assistant';
  content_text: string;
  created_at: string;
}

// Returns sessions sorted newest-first
export const getCharacterSessions = (characterId: string): Promise<{ sessions: ApiSession[] }> =>
  apiGet(`/sessions/character/${characterId}?limit=10`);

// Returns turns sorted oldest-first (chronological)
export const getConversationTurns = (sessionId: string): Promise<{ turns: ApiTurn[] }> =>
  apiGet(`/conversations/${sessionId}?limit=100`);

// ── Memories ───────────────────────────────────────────────────────────────

export interface ApiMemory {
  _id: string;
  type: 'fact' | 'emotion' | 'event' | 'preference';
  content: string;
  character_id: string;
  created_at: string;
}

export const getMemories = (characterId: string, type?: string): Promise<ApiMemory[]> => {
  const qs = type && type !== 'all' ? `?type=${type}` : '';
  return apiGet<ApiMemory[]>(`/memories/${characterId}${qs}`);
};

export const deleteMemory = (memoryId: string): Promise<unknown> =>
  apiDelete(`/memories/${memoryId}`);

export const deleteAllMemories = (characterId: string): Promise<unknown> =>
  apiDelete(`/memories/character/${characterId}`);

// ── Voices ─────────────────────────────────────────────────────────────────

export interface ApiVoice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  personality?: string;
  previewText?: string;
}

export const getVoices = (): Promise<ApiVoice[]> =>
  apiGet<ApiVoice[]>('/voice/voices');

// ── Voice sessions ─────────────────────────────────────────────────────────

export interface VoiceSessionResponse {
  session_id: string;
  livekit_token: string;
  livekit_url: string;
  room_name: string;
}

export const startVoiceSession = (userId: string, characterId: string): Promise<VoiceSessionResponse> =>
  apiPost('/voice/sessions/start', { user_id: userId, character_id: characterId });

// Defensive end-of-call call. Backend also auto-ends on LiveKit ParticipantDisconnected,
// so this is idempotent and safe to fire-and-forget.
export const endVoiceSession = (sessionId: string): Promise<unknown> =>
  apiPost(`/sessions/${sessionId}/end`, {});
