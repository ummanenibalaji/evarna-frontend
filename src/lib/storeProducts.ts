/**
 * Which plan a Google Play product is. Play names a subscription
 * "subscriptionId:basePlanId" ("evarna.plus:annual"), and RevenueCat also reports
 * the package type, which wins when present. Pure, so it's checked offline.
 */
export type PaidTier = 'plus' | 'premium';

export function tierAndPeriodOf(productId: string, packageType?: string | null): { tier: PaidTier; annual: boolean } | null {
  const [subscription, basePlan = ''] = productId.split(':');
  const tier: PaidTier | null = subscription === 'evarna.plus' ? 'plus' : subscription === 'evarna.premium' ? 'premium' : null;
  if (!tier) return null;
  const annual = packageType && packageType !== 'UNKNOWN' && packageType !== 'CUSTOM'
    ? packageType === 'ANNUAL'
    : basePlan === 'annual';
  return { tier, annual };
}
