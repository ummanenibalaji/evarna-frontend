/**
 * Offline check for the entitlement helpers and the refused-turn logic.
 *
 *   npm run check:entitlement
 *
 * This repo has no test runner, and the functions below are the ones where a
 * silent mistake becomes a lie told to a paying user: a plan card advertising
 * minutes the tier does not have, a balance rounded to zero while a call is
 * still possible, "Renews on" over a subscription that is not renewing, or a
 * refused message taking an unrelated bubble out of someone's history.
 *
 * Everything here is pure — no React, no network, no AsyncStorage — which is
 * why `quotaCode` reads `code` structurally instead of importing ApiError.
 */
import {
  balanceLine, formatBalance, formatResetDate, minutesFrom, planFeatures, priceFor, quotaCode, resetLabel,
} from '../lib/entitlement';
import { dropRefusedTurn, restoreDraft } from '../lib/chatTurns';
import type { ApiBillingPlan, ApiEntitlement } from '../api';

let failures = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}\n      got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); failures++; }
};
const refusal = (status: number, code: string) => ({ status, code, name: 'ApiError' });

const PLUS: ApiBillingPlan = { tier: 'plus', label: 'Plus', voice_minutes: 120, daily_messages: 1000, monthly_usd: 19.99, annual_monthly_usd: 12.49, product_ids: { monthly: 'evarna.plus.monthly', annual: 'evarna.plus.annual' } };
const PREMIUM: ApiBillingPlan = { tier: 'premium', label: 'Premium', voice_minutes: 400, daily_messages: 2000, monthly_usd: 39.99, annual_monthly_usd: 24.99, product_ids: { monthly: 'evarna.premium.monthly', annual: 'evarna.premium.annual' } };

const base = (over: Partial<ApiEntitlement> = {}): ApiEntitlement => ({
  tier: 'free', tier_label: 'Free', status: 'none', platform: 'none', auto_renew: false, expires_at: null,
  voice: { allowance_seconds: 480, topup_seconds: 0, used_seconds: 0, in_flight_seconds: 0, remaining_seconds: 480 },
  text: { daily_cap: 100, used_today: 0, remaining_today: 100, resets_at: '2026-09-14T00:00:00.000Z' },
  period: { start: '2026-09-12T00:00:00.000Z', end: '2026-10-12T12:00:00.000Z', renews_at: '2026-10-12T12:00:00.000Z', source: 'signup_anniversary' },
  plans: [PLUS, PREMIUM], topup_packs: [], degraded: false, ...over,
});
const subscribed = (over: Partial<ApiEntitlement> = {}) =>
  base({ tier: 'plus', status: 'active', auto_renew: true, period: { ...base().period, source: 'subscription' }, ...over });

console.log('\nA balance someone can read');
check('nothing left reads as 0 min', formatBalance(0), '0 min');
// A call still connects with 40 seconds, so "0 min" would be wrong twice over.
check('under a minute reads in seconds', formatBalance(40), '40 sec');
check('59s is still seconds', formatBalance(59), '59 sec');
check('60s is a minute', formatBalance(60), '1 min');
check('the free allowance is 8 min', formatBalance(480), '8 min');
check('whole minutes floor', minutesFrom(59), 0);
check('never negative', minutesFrom(-90), 0);

console.log('\nWhen the allowance comes back');
const NOW = new Date('2026-09-13T00:00:00Z');
check('a date this year omits the year', formatResetDate('2026-10-12T12:00:00.000Z', NOW), 'October 12');
check('a date beyond it keeps the year', formatResetDate('2027-01-05T12:00:00.000Z', NOW), 'January 5, 2027');
check('an unparseable date renders nothing', formatResetDate('not-a-date', NOW), '');
check('a free allowance resets', resetLabel(base()), 'Minutes reset on');
check('a renewing subscription renews', resetLabel(subscribed()), 'Renews on');
// Auto-renew off is the same promise as cancelled: paid through, not renewing.
check('auto-renew off is access, not renewal', resetLabel(subscribed({ auto_renew: false })), 'Access until');
check('cancelled runs out', resetLabel(base({ status: 'cancelled' })), 'Access until');
check('expired is past tense', resetLabel(base({ status: 'expired' })), 'Expired on');

console.log('\nThe store catalog');
// The drift this replaced: the paywall card claimed 500 min for a 400 min tier.
check('premium advertises its real allowance', planFeatures(PREMIUM)[0], '400 voice min/mo');
check('plus advertises its real allowance', planFeatures(PLUS)[0], '120 voice min/mo');
check('no card promises a cap nothing enforces', planFeatures(PLUS).includes('Up to 3 companions'), false);
check('plus advertises its real message cap', planFeatures(PLUS)[1], '1,000 messages a day');
check('premium advertises its real message cap', planFeatures(PREMIUM)[1], '2,000 messages a day');
check('no card promises unlimited text over a daily cap', [...planFeatures(PLUS), ...planFeatures(PREMIUM)].some((l) => /unlimited/i.test(l)), false);
check('monthly price', priceFor(PLUS, false), '$19.99');
check('an annual plan is priced per month', priceFor(PREMIUM, true), '$24.99');

console.log('\nThe top-up balance line');
check('a healthy balance is not a warning', balanceLine(base()).urgent, false);
check('a healthy balance reads plainly', balanceLine(base()).text, 'You have 8 min left this month.');
check('a low balance warns', balanceLine(base({ voice: { ...base().voice, remaining_seconds: 180 } })).urgent, true);
check('an empty balance says when it returns', balanceLine(base({ voice: { ...base().voice, remaining_seconds: 0 } })).text, "⚠ You're out of voice minutes. They reset October 12.");

console.log('\nRefusals the server sends');
check('the message cap is recognised', quotaCode(refusal(429, 'DAILY_MESSAGE_CAP')), 'DAILY_MESSAGE_CAP');
check('an unrelated code is not', quotaCode(refusal(403, 'STUDIO_LIMIT_REACHED')), null);
check('a network error is not', quotaCode(new Error('offline')), null);
check('nothing at all is not', quotaCode(null), null);

console.log('\nTaking back a refused turn');
type M = { from: string; text?: string; streaming?: boolean };
const history: M[] = [
  { from: 'user', text: 'thanks' },
  { from: 'comp', text: 'any time' },
  { from: 'user', text: 'thanks' },
  { from: 'comp', text: '', streaming: true },
];
// Removing by text deleted the identical older bubble — in real history, loaded
// from the backend. "ok", "hey" and "thanks" get said more than once.
check('only the turn just sent is taken back', dropRefusedTurn(history, 'thanks'), [
  { from: 'user', text: 'thanks' },
  { from: 'comp', text: 'any time' },
]);
check('an unrelated last message is left alone', dropRefusedTurn([{ from: 'comp', text: 'hi' }], 'thanks'), [{ from: 'comp', text: 'hi' }]);
check('the typed text comes back', restoreDraft('', 'are you there?'), 'are you there?');
check('but never over something newer', restoreDraft('a new thought', 'are you there?'), 'a new thought');
check('whitespace does not count as newer', restoreDraft('   ', 'are you there?'), 'are you there?');

console.log(failures === 0 ? '\nAll entitlement checks passed.\n' : `\n${failures} entitlement check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
