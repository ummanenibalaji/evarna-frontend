// Google Play purchases through RevenueCat.
//
// The native module only exists in a development or store build. In Expo Go, on
// iOS (not in v1), or without a key, every call here is a no-op and the paywall
// says purchases aren't available, rather than crashing or pretending.
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { tierAndPeriodOf, PaidTier } from './storeProducts';

type PurchasesModule = typeof import('react-native-purchases').default;

const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';
let module_: PurchasesModule | null | undefined;
let configured = false;

function load(): PurchasesModule | null {
  if (module_ !== undefined) return module_;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    module_ = (require('react-native-purchases') as { default: PurchasesModule }).default;
  } catch {
    module_ = null;
  }
  return module_;
}

/** True when this build can take a payment. */
export function storeAvailable(): boolean {
  return Platform.OS === 'android' && ANDROID_KEY.length > 0 && load() !== null;
}

/** Ties purchases to our user id, so the server can find them. */
export async function purchasesSignIn(userId: string): Promise<void> {
  if (!storeAvailable()) return;
  const Purchases = load()!;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: ANDROID_KEY, appUserID: userId });
      configured = true;
    } else {
      await Purchases.logIn(userId);
    }
  } catch {
    // The store is unreachable; the paywall reports it when opened.
  }
}

export async function purchasesSignOut(): Promise<void> {
  if (!configured) return;
  await load()?.logOut().catch(() => {});
}

export interface StorePlan {
  tier: PaidTier;
  annual: boolean;
  /** Localised by Google Play, for the price of the whole period. */
  priceString: string;
  hasFreeTrial: boolean;
  pkg: PurchasesPackage;
}

export async function loadStorePlans(): Promise<StorePlan[]> {
  if (!storeAvailable() || !configured) return [];
  const offerings = await load()!.getOfferings();
  return (offerings.current?.availablePackages ?? []).flatMap((pkg) => {
    const plan = tierAndPeriodOf(pkg.product.identifier, pkg.packageType);
    return plan
      ? [{ ...plan, priceString: pkg.product.priceString, hasFreeTrial: !!pkg.product.defaultOption?.freePhase, pkg }]
      : [];
  });
}

export async function buyPlan(plan: StorePlan): Promise<'purchased' | 'cancelled'> {
  try {
    await load()!.purchasePackage(plan.pkg);
    return 'purchased';
  } catch (e) {
    if ((e as { userCancelled?: boolean | null }).userCancelled) return 'cancelled';
    throw e;
  }
}

export async function restorePurchases(): Promise<void> {
  await load()!.restorePurchases();
}
