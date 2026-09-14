/**
 * "You're talking with an AI" — the notice US companion-chatbot laws require.
 *
 * New York (in force Nov 2025): at the start of every AI companion interaction
 * and at least every 3 hours of continued use, for every user.
 * California SB 243 (in force Jan 2026): for users known to be minors, a
 * reminder at least every 3 hours that the companion is AI and to take a break.
 *
 * Pure so the timing and wording are checked offline (check:ai-notice). The
 * notice is rendered by the screen; it is never sent or saved as a message.
 */
export const AI_NOTICE_INTERVAL_MS = 3 * 60 * 60 * 1000;

/** Whether a continuing conversation owes the user another notice. */
export function aiNoticeDue(lastShownAt: number, now: number): boolean {
  return now - lastShownAt >= AI_NOTICE_INTERVAL_MS;
}

export function aiNoticeText(name: string, isMinor: boolean, repeat: boolean): string {
  if (!repeat) return `You're talking with ${name}, an AI, not a person.`;
  return isMinor
    ? `You've been chatting for a while. ${name} is an AI, not a person, and this is a good moment for a break.`
    : `A reminder: ${name} is an AI, not a person.`;
}
