import { apiGet, apiPost, apiPatch, apiDelete } from './client';

// ── Auth ───────────────────────────────────────────────────────────────────

// Every sign-in route returns the same session shape. `token` goes to
// setAuthToken(); everything after that is authenticated by header, not by a
// client-supplied user_id.
export interface AuthSession {
  token: string;
  user_id: string;
  onboarding_completed: boolean;
}

export const signInWithGoogle = (idToken: string): Promise<AuthSession> =>
  apiPost<AuthSession>('/auth/google', { id_token: idToken });

export const signInWithApple = (idToken: string): Promise<AuthSession> =>
  apiPost<AuthSession>('/auth/apple', { id_token: idToken });

export const requestEmailCode = (email: string): Promise<{ sent: boolean }> =>
  apiPost<{ sent: boolean }>('/auth/email/request', { email });

// `code` is exactly 6 digits.
export const verifyEmailCode = (email: string, code: string): Promise<AuthSession> =>
  apiPost<AuthSession>('/auth/email/verify', { email, code });

export interface ApiMe {
  user_id: string;
  email: string;
  display_name: string;
  gender: string;
  communication_style: string;
  onboarding_completed: boolean;
  is_minor: boolean;
  member_since: string;
}

export const getMe = (): Promise<ApiMe> => apiGet<ApiMe>('/auth/me');

// Signs out ALL devices.
export const logout = (): Promise<unknown> => apiPost('/auth/logout', {});

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
  is_minor: boolean;
}

export const onboardUser = (p: OnboardPayload): Promise<OnboardResponse> =>
  apiPost<OnboardResponse>('/users/onboard', p);

// ── Characters ─────────────────────────────────────────────────────────────

// Shape returned by GET /characters (scoped to the signed-in user by the token).
// The backend is the source of truth for archetype names ("bestfriend" —
// frontend maps that to "friend").
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
export const getUserCharacters = async (): Promise<ApiCharacter[]> => {
  const res = await apiGet<{ characters: ApiCharacter[] }>('/characters');
  return res.characters;
};

export interface CreateCharacterPayload {
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

export interface UpdateCharacterPayload {
  name?: string;
  voice_id?: string;
  personality_sliders?: Record<string, number>;
}

export const updateCharacter = (characterId: string, p: UpdateCharacterPayload): Promise<unknown> =>
  apiPatch(`/characters/${characterId}`, p);

// Soft delete — the companion disappears from GET /characters.
export const deleteCharacter = (characterId: string): Promise<unknown> =>
  apiDelete(`/characters/${characterId}`);

// ── Studio ─────────────────────────────────────────────────────────────────

// Backend gender enum. The Studio UI offers male/female/neutral and maps
// neutral → nonbinary at this boundary.
export type ApiGender = 'male' | 'female' | 'nonbinary';

// Param definitions come from the server so the setup form and the persona
// that consumes it never drift apart.
export interface ApiScenarioParam {
  key: string;
  label: string;
  type: 'text' | 'choice';
  options?: string[];
  placeholder?: string;
  required: boolean;
}

export interface ApiScenario {
  id: string;
  name: string;
  description: string;
  params: ApiScenarioParam[];
}

export const getScenarios = (): Promise<ApiScenario[]> =>
  apiGet<ApiScenario[]>('/studio/scenarios');

// Discriminated on `kind` — the backend accepts exactly these two shapes.
// `personality_sliders` are 0–100 integers (the creator UI stores 0–1 floats).
export type CreateStudioCharacterPayload =
  | { kind: 'scenario'; scenario_id: string; params: Record<string, string>; voice_id: string; gender: ApiGender }
  | { kind: 'custom'; name: string; backstory?: string; voice_id: string; gender: ApiGender; personality_sliders?: Record<string, number> };

export interface CreateStudioCharacterResponse {
  character_id: string;
  name: string;
  mode: string;
  kind: 'scenario' | 'custom';
}

// 400 → ApiError with code 'VALIDATION_ERROR', 403 → 'STUDIO_LIMIT_REACHED'.
export const createStudioCharacter = (p: CreateStudioCharacterPayload): Promise<CreateStudioCharacterResponse> =>
  apiPost<CreateStudioCharacterResponse>('/studio/characters', p);

export interface ApiStudioCharacter {
  _id: string;
  name: string;
  gender: ApiGender;
  voice_id: string;
  kind: 'scenario' | 'custom';
  scenario_id?: string;
  last_interaction_at?: string;
  total_sessions?: number;
}

// Same { characters: [...] } wrapper as GET /characters — unwrap here.
export const getStudioCharacters = async (): Promise<ApiStudioCharacter[]> => {
  const res = await apiGet<{ characters: ApiStudioCharacter[] }>('/studio/characters');
  return res.characters;
};

// ── User stats ─────────────────────────────────────────────────────────────

export interface ApiUserStats {
  total_companions: number;
  total_sessions: number;
  total_voice_minutes: number;
  total_memories: number;
  member_since: string;
}

export const getUserStats = (): Promise<ApiUserStats> =>
  apiGet<ApiUserStats>('/users/me/stats');

// ── Account ────────────────────────────────────────────────────────────────

export interface UpdateMePayload {
  display_name?: string;
  communication_style?: string;
  gender?: string;
}

export const updateMe = (p: UpdateMePayload): Promise<unknown> =>
  apiPatch('/users/me', p);

// Irreversible. The backend requires the literal confirmation string.
export const deleteMe = (): Promise<unknown> =>
  apiDelete('/users/me', { confirm: 'DELETE' });

// The user's full data as JSON (App Store data-portability requirement).
export const exportMyData = (): Promise<unknown> =>
  apiGet('/users/me/export');

// ── Sessions ───────────────────────────────────────────────────────────────

// `remember` is optional and omitted unless given — the backend defaults it to
// true, so the companion chat call sites keep their two-argument form. Passing
// false stores Session.memory_enabled = false and skips memory extraction on end.
export const startSession = (
  characterId: string,
  // Mirrors the backend enum exactly. It used to say 'voice', which no route
  // accepts — nothing ever passed it, so it was a 400 waiting for the first
  // caller who trusted the type.
  sessionType: 'text' | 'voice_call' | 'voice_note' = 'text',
  remember?: boolean,
): Promise<{ session_id: string }> =>
  apiPost('/sessions/start', {
    character_id: characterId,
    session_type: sessionType,
    ...(remember === undefined ? {} : { remember }),
  });

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

export const startVoiceSession = (characterId: string): Promise<VoiceSessionResponse> =>
  apiPost('/voice/sessions/start', { character_id: characterId });

// Defensive end-of-call call. Backend also auto-ends on LiveKit ParticipantDisconnected,
// so this is idempotent and safe to fire-and-forget.
export const endVoiceSession = (sessionId: string): Promise<unknown> =>
  apiPost(`/sessions/${sessionId}/end`, {});

// ── Reports ────────────────────────────────────────────────────────────────

// Apple Guideline 1.2 — users must be able to report AI-generated content.
export type ReportReason = 'harmful' | 'sexual' | 'inappropriate_minor' | 'inaccurate' | 'other';

export const createReport = (turnId: string, reason: ReportReason, note?: string): Promise<{ report_id: string }> =>
  apiPost('/reports', { turn_id: turnId, reason, ...(note ? { note: note.slice(0, 1000) } : {}) });
