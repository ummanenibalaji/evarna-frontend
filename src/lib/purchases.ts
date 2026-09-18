// Store purchases through RevenueCat: Google Play on Android, the App Store on
// iOS.
//
// The native module only exists in a development or store build, and each
// platform needs its own RevenueCat key (EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
// EXPO_PUBLIC_REVENUECAT_IOS_KEY). In Expo Go, or on a platform whose key is
// not set, every call here is a no-op and the paywall says purchases aren't
// available, rather than crashing or pretending.
import { Linking, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { subscriptionIdOf, tierAndPeriodOf, PaidTier } from './storeProducts';
import { withSystemPrompt } from '../components/PrivacyShield';

type PurchasesModule = typeof import('react-native-purchases').default;

export type StorePlatform = 'ios' | 'android';

/** The store this device buys through, or null on a platform with none. */
export const DEVICE_STORE: StorePlatform | null =
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;

const API_KEY = (DEVICE_STORE === 'ios'
  ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
  : DEVICE_STORE === 'android'
    ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
    : '') || '';

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

/** True when this build can take a payment on this device. */
export function storeAvailable(): boolean {
  return API_KEY.length > 0 && load() !== null;
}

/**
 * The store's name for the middle of a sentence: "Cancel anytime in Google
 * Play", "Manage it in the App Store". Defaults to this device's store.
 */
export function storeName(store: StorePlatform | null = DEVICE_STORE): string {
  return store === 'ios' ? 'the App Store' : 'Google Play';
}

/** Ties purchases to our user id, so the server can find them. */
export async function purchasesSignIn(userId: string): Promise<void> {
  if (!storeAvailable()) return;
  const Purchases = load()!;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: API_KEY, appUserID: userId });
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
  /** The store's own product id ("evarna.plus:annual" on Play). */
  productId: string;
  /** Localised by the store, for the price of the whole period. */
  priceString: string;
  /** The same price as a number, in `currencyCode`. */
  price: number;
  /** Localised price per month (an annual plan divided by twelve), when the store gives one. */
  pricePerMonthString: string | null;
  hasFreeTrial: boolean;
  pkg: PurchasesPackage;
}

/** The store can't be reached yet: RevenueCat is configured once the account is known. */
export class StoreNotReadyError extends Error {
  constructor() {
    super('The store is not ready yet.');
    this.name = 'StoreNotReadyError';
  }
}

/** What the store currently sells. Throws when it can't be asked. */
export async function loadStorePlans(): Promise<StorePlan[]> {
  if (!storeAvailable()) return [];
  if (!configured) throw new StoreNotReadyError();
  const offerings = await load()!.getOfferings();
  return (offerings.current?.availablePackages ?? []).flatMap((pkg) => {
    const plan = tierAndPeriodOf(pkg.product.identifier, pkg.packageType);
    if (!plan) return [];
    return [{
      ...plan,
      productId: pkg.product.identifier,
      priceString: pkg.product.priceString,
      price: pkg.product.price,
      pricePerMonthString: pkg.product.pricePerMonthString ?? null,
      // Play applies trial eligibility to the default option itself. The App
      // Store needs a separate eligibility check, so iOS never claims a trial.
      hasFreeTrial: !!pkg.product.defaultOption?.freePhase,
      pkg,
    }];
  });
}

/**
 * 'pending' is a real outcome on Google Play: some payment methods (cash,
 * bank transfer) confirm days later. The plan unlocks when they do.
 */
export type PurchaseOutcome = 'purchased' | 'cancelled' | 'pending';

const ERR = {
  cancelled: '1',
  notAllowed: '3',
  alreadyOwned: '6',
  network: '10',
  pending: '20',
  timedOut: '32',
  offline: '35',
} as const;

const codeOf = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

export async function buyPlan(plan: StorePlan): Promise<PurchaseOutcome> {
  const Purchases = load()!;
  // Google Play keeps an existing subscription running beside a new one unless
  // the purchase says it replaces it, which would bill the user twice for an
  // upgrade. The App Store upgrades within a subscription group on its own.
  let change: { oldProductIdentifier: string } | null = null;
  if (DEVICE_STORE === 'android') {
    const info = await Purchases.getCustomerInfo();
    const current = info.activeSubscriptions.find(id => id !== plan.productId && tierAndPeriodOf(id) !== null);
    if (current) change = { oldProductIdentifier: subscriptionIdOf(current) };
  }
  try {
    // The store's sheet turns the app inactive while it is up; without this
    // the app-switcher cover would hide the paywall underneath it.
    await withSystemPrompt(() => Purchases.purchasePackage(plan.pkg, null, change));
    return 'purchased';
  } catch (e) {
    const code = codeOf(e);
    if (code === ERR.cancelled || (e as { userCancelled?: boolean | null }).userCancelled) return 'cancelled';
    if (code === ERR.pending) return 'pending';
    throw e;
  }
}

/**
 * Asks the store for this account's past purchases. Resolves true when it
 * holds an active Evarna subscription, so "nothing found" and "our server
 * didn't answer" can be told apart afterwards.
 */
export async function restorePurchases(): Promise<boolean> {
  // The App Store may ask for the Apple ID password over the paywall first,
  // and that sheet, like the purchase one, must not raise the privacy cover.
  const Purchases = load()!;
  const info = await withSystemPrompt(() => Purchases.restorePurchases());
  return info.activeSubscriptions.some(id => tierAndPeriodOf(id) !== null);
}

/** Why a store call failed, in the terms the paywall words its message by. */
export type StoreFailure = 'offline' | 'not-allowed' | 'already-owned' | 'other';

export function storeFailureOf(e: unknown): StoreFailure {
  const code = codeOf(e);
  if (code === ERR.network || code === ERR.offline || code === ERR.timedOut) return 'offline';
  if (code === ERR.notAllowed) return 'not-allowed';
  if (code === ERR.alreadyOwned) return 'already-owned';
  return 'other';
}

const MANAGE_URL: Record<StorePlatform, string> = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
};

/**
 * Opens the store's own subscription management: where plans are changed,
 * downgraded or cancelled. Resolves false when nothing could be opened.
 */
export async function openManageSubscriptions(): Promise<boolean> {
  if (!DEVICE_STORE) return false;
  const Purchases = storeAvailable() && configured ? load() : null;
  try {
    if (Purchases && DEVICE_STORE === 'ios') {
      await Purchases.showManageSubscriptions();
      return true;
    }
    // RevenueCat's link goes straight to this app's subscription on Play.
    const url = Purchases ? (await Purchases.getCustomerInfo()).managementURL : null;
    await Linking.openURL(url ?? MANAGE_URL[DEVICE_STORE]);
    return true;
  } catch {
    return Linking.openURL(MANAGE_URL[DEVICE_STORE]).then(() => true, () => false);
  }
}
