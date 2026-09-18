/**
 * Which plan a store product is. Google Play names a subscription
 * "subscriptionId:basePlanId" ("evarna.plus:annual"); the App Store has no base
 * plans, so its products are "evarna.plus.annual". Both forms are accepted, the
 * same way the backend reads them (revenuecat.service.ts, tierForProduct).
 * RevenueCat also reports the package type, which wins when present.
 * Pure, so it's checked offline.
 */
export type PaidTier = 'plus' | 'premium';

const TIERS: Record<string, PaidTier> = { 'evarna.plus': 'plus', 'evarna.premium': 'premium' };
const ANNUAL_SUFFIX = /^(annual|yearly|year|p1y)$/i;

export function tierAndPeriodOf(productId: string, packageType?: string | null): { tier: PaidTier; annual: boolean } | null {
  const [subscription = '', basePlan = ''] = productId.split(':');
  // "evarna.plus" (Play) or "evarna.plus.annual" (App Store).
  const root = Object.keys(TIERS).find(k => subscription === k || subscription.startsWith(`${k}.`));
  if (!root) return null;
  const period = basePlan || subscription.slice(root.length + 1);
  const annual = packageType && packageType !== 'UNKNOWN' && packageType !== 'CUSTOM'
    ? packageType === 'ANNUAL'
    : ANNUAL_SUFFIX.test(period);
  return { tier: TIERS[root], annual };
}

/** The Play subscription id without its base plan, which is what a plan change replaces. */
export function subscriptionIdOf(productId: string): string {
  return productId.split(':')[0] ?? productId;
}
