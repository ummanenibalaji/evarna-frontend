/**
 * Reading an entitlement: the small decisions that were previously spread
 * across the screens as constants.
 *
 * Pure on purpose — no React, no imports from screens — so it can be asserted
 * by a plain node script. This is where the drift lived: the paywall advertised
 * "500 voice min/mo" for a 400-minute tier because the copy was typed by hand
 * in JSX instead of derived from the plan.
 */
import type { ApiBillingPlan, ApiEntitlement } from '../api';

export type QuotaCode = 'VOICE_MINUTES_EXHAUSTED' | 'DAILY_MESSAGE_CAP' | 'CALL_IN_PROGRESS';

const QUOTA_CODES: QuotaCode[] = ['VOICE_MINUTES_EXHAUSTED', 'DAILY_MESSAGE_CAP', 'CALL_IN_PROGRESS'];

/**
 * The refusal code on an error, or null if it was any other failure.
 *
 * Reads the `code` field structurally rather than testing `e instanceof
 * ApiError`, which keeps this module free of any runtime import from the API
 * client — that client pulls in AsyncStorage, and importing it here would make
 * these helpers unassertable outside a React Native runtime.
 */
export function quotaCode(e: unknown): QuotaCode | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (QUOTA_CODES as string[]).includes(code) ? (code as QuotaCode) : null;
}

/** Whole minutes, floored: 59s of allowance left is not "1 minute". */
export function minutesFrom(seconds: number): number {
  return Math.max(0, Math.floor(seconds / 60));
}

/**
 * A balance a person can read. Seconds are shown under a minute because "0 min"
 * for someone who still has 40 seconds of call left is wrong in both directions
 * — it reads as spent, and the call will still connect.
 */
export function formatBalance(seconds: number): string {
  if (seconds <= 0) return '0 min';
  if (seconds < 60) return `${Math.floor(seconds)} sec`;
  return `${minutesFrom(seconds)} min`;
}

/**
 * "June 1" this year, "June 1, 2027" beyond it — the year only when it matters.
 *
 * Formatted in the reader's own timezone, so a period that ends at 18:51 UTC
 * shows as the 13th for someone in Asia/Kolkata. That is the date on their
 * calendar, which is the only date that means anything to them.
 */
export function formatResetDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * The label above the reset date. A free allowance resetting is not a renewal,
 * and a cancelled subscription is not renewing at all — the app used to say
 * "Renews on June 1, 2026" to every account, including ones that had never
 * bought anything.
 */
export function resetLabel(e: ApiEntitlement): string {
  if (e.status === 'cancelled') return 'Access until';
  if (e.status === 'expired') return 'Expired on';
  // Auto-renew off is the same promise as cancelled, whatever the status says:
  // they keep the plan to the end of what they paid for and it does not renew.
  // Calling that "Renews on" is exactly the dishonest copy this replaced.
  if (e.status === 'active' && !e.auto_renew && e.period.source === 'subscription') return 'Access until';
  return e.period.source === 'subscription' ? 'Renews on' : 'Minutes reset on';
}

/** The plan card's bullet list, derived so the minutes and messages can never contradict the tier. */
export function planFeatures(p: ApiBillingPlan): string[] {
  // "Unlimited text" was shown over a 1,000-a-day cap. The number comes from
  // the server's plan, which reads it from the tier the gate enforces.
  const messages = `${p.daily_messages.toLocaleString('en-US')} messages a day`;
  // "Up to 5 companions" on both, deliberately: five is the flat cap the app
  // actually enforces (MAX_COMPANIONS), and the backend has no per-tier
  // companion limit yet. The card used to claim 3 for Plus, which nothing
  // implemented. Derive this from the plan once the backend serves it.
  return p.tier === 'plus'
    ? [`${p.voice_minutes} voice min/mo`, messages, 'All companion types', 'Up to 5 companions', 'Full Studio access']
    : [`${p.voice_minutes} voice min/mo`, messages, 'Everything in Plus', 'Custom characters', 'Priority responses'];
}

export const priceFor = (p: ApiBillingPlan, annual: boolean): string =>
  `$${(annual ? p.annual_monthly_usd : p.monthly_usd).toFixed(2)}`;

/** Below this, the top-up sheet and the in-call banner start warning. */
export const LOW_BALANCE_SECONDS = 300;

/** The top-up sheet's balance line: neutral, warning, or spent. */
export function balanceLine(e: ApiEntitlement): { text: string; urgent: boolean } {
  const left = e.voice.remaining_seconds;
  if (left <= 0) {
    return { text: `⚠ You're out of voice minutes. They reset ${formatResetDate(e.period.renews_at)}.`, urgent: true };
  }
  if (left <= LOW_BALANCE_SECONDS) {
    return { text: `⚠ Only ${formatBalance(left)} left this month.`, urgent: true };
  }
  return { text: `You have ${formatBalance(left)} left this month.`, urgent: false };
}
