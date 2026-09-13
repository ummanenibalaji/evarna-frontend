/**
 * Undoing an optimistically-shown turn.
 *
 * When the server refuses a message (the daily cap), the two bubbles the screen
 * already added have to come off: the streaming placeholder and the user's own
 * line. Removing them by matching TEXT deletes every earlier bubble that
 * happens to say the same thing — and "ok", "hey" and "thanks" get said a lot,
 * in a transcript loaded from the backend. So pop from the end instead.
 */
export interface OptimisticTurn {
  from: string;
  text?: string;
  streaming?: boolean;
}

export function dropRefusedTurn<T extends OptimisticTurn>(msgs: T[], sentText: string): T[] {
  const out = [...msgs];
  if (out[out.length - 1]?.streaming) out.pop();
  const last = out[out.length - 1];
  if (last && last.from === 'user' && last.text === sentText) out.pop();
  return out;
}

/**
 * Hand back what they typed — but never over the top of something newer. Losing
 * a sentence someone wrote is the worst way to tell them about a limit, and
 * overwriting the sentence they wrote while waiting is a close second.
 */
export const restoreDraft = (current: string, sentText: string): string =>
  current.trim() ? current : sentText;
