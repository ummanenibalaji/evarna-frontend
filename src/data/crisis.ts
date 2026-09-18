/**
 * Crisis resources for where the person actually is.
 *
 * The screen used to list 988 and "text HOME to 741741" for everyone, and
 * neither works outside North America, so someone in India reaching for help
 * was handed numbers that go nowhere. A wrong number is worse than a generic
 * pointer, so anything this cannot place with confidence gets OTHER: "your
 * local emergency number" and a worldwide directory.
 *
 * The numbers are fixed by review; do not edit them without checking the
 * source services. check:crisis guards the region mapping and that every
 * resource can be opened.
 *
 * react-native is required lazily so the data and region logic stay
 * importable by that plain node script.
 */

export type CrisisRegion = 'IN' | 'US' | 'GB' | 'CA' | 'AU' | 'OTHER';

export interface CrisisResource {
  id: string;
  name: string;
  /** One plain line: how to reach them and what they are. */
  detail: string;
  kind: 'call' | 'text' | 'web';
  /**
   * Number to call or text, or the URL to open. Empty when there is nothing to
   * dial (OTHER's emergency entry): render it as text, without an action. See
   * canOpenCrisisResource.
   */
  value: string;
  hours?: string;
  /** Prefilled message for a text line. */
  body?: string;
}

const ALWAYS = '24/7';

const RESOURCES: Record<CrisisRegion, { emergency: CrisisResource; resources: CrisisResource[] }> = {
  IN: {
    emergency: { id: 'in-emergency', name: 'Emergency services', detail: 'Call 112', kind: 'call', value: '112' },
    resources: [
      {
        id: 'in-tele-manas', name: 'Tele-MANAS',
        detail: 'Call 14416 or 1-800-891-4416. Free, from the Government of India, in many languages.',
        kind: 'call', value: '14416', hours: ALWAYS,
      },
      {
        id: 'in-vandrevala', name: 'Vandrevala Foundation',
        detail: 'Call or WhatsApp +91 9999 666 555',
        kind: 'call', value: '+919999666555', hours: ALWAYS,
      },
      { id: 'in-aasra', name: 'AASRA', detail: 'Call +91 98204 66726', kind: 'call', value: '+919820466726', hours: ALWAYS },
      { id: 'in-icall', name: 'iCall', detail: 'Call +91 91529 87821', kind: 'call', value: '+919152987821', hours: 'Mon–Sat, 10am–8pm' },
    ],
  },
  US: {
    emergency: { id: 'us-emergency', name: 'Emergency services', detail: 'Call 911', kind: 'call', value: '911' },
    resources: [
      { id: 'us-988-call', name: '988 Suicide & Crisis Lifeline', detail: 'Call 988', kind: 'call', value: '988', hours: ALWAYS },
      { id: 'us-988-text', name: '988 Suicide & Crisis Lifeline', detail: 'Text 988', kind: 'text', value: '988', hours: ALWAYS },
      { id: 'us-crisis-text-line', name: 'Crisis Text Line', detail: 'Text HOME to 741741', kind: 'text', value: '741741', body: 'HOME' },
    ],
  },
  GB: {
    emergency: { id: 'gb-emergency', name: 'Emergency services', detail: 'Call 999', kind: 'call', value: '999' },
    resources: [
      { id: 'gb-samaritans', name: 'Samaritans', detail: 'Call 116 123. Free.', kind: 'call', value: '116123', hours: ALWAYS },
      { id: 'gb-shout', name: 'Shout', detail: 'Text SHOUT to 85258', kind: 'text', value: '85258', body: 'SHOUT' },
    ],
  },
  CA: {
    emergency: { id: 'ca-emergency', name: 'Emergency services', detail: 'Call 911', kind: 'call', value: '911' },
    resources: [
      { id: 'ca-988-call', name: '988 Suicide Crisis Helpline', detail: 'Call 988', kind: 'call', value: '988', hours: ALWAYS },
      { id: 'ca-988-text', name: '988 Suicide Crisis Helpline', detail: 'Text 988', kind: 'text', value: '988', hours: ALWAYS },
    ],
  },
  AU: {
    emergency: { id: 'au-emergency', name: 'Emergency services', detail: 'Call 000', kind: 'call', value: '000' },
    resources: [
      { id: 'au-lifeline-call', name: 'Lifeline', detail: 'Call 13 11 14', kind: 'call', value: '131114', hours: ALWAYS },
      { id: 'au-lifeline-text', name: 'Lifeline', detail: 'Text 0477 13 11 14', kind: 'text', value: '0477131114' },
    ],
  },
  OTHER: {
    emergency: { id: 'other-emergency', name: 'Emergency services', detail: 'Call your local emergency number', kind: 'call', value: '' },
    resources: [
      {
        id: 'other-find-a-helpline', name: 'Find A Helpline',
        detail: 'Find a helpline in your country',
        kind: 'web', value: 'https://findahelpline.com',
      },
    ],
  },
};

// Zones that settle the question on their own. Everything in the Americas that
// is not listed here is too broad to assume (Mexico, Brazil and the Caribbean
// all have their own numbers), so it defers to the locale.
const CA_ZONES = new Set([
  'America/Toronto', 'America/Montreal', 'America/Nipigon', 'America/Thunder_Bay', 'America/Iqaluit',
  'America/Pangnirtung', 'America/Atikokan', 'America/Coral_Harbour', 'America/Winnipeg', 'America/Rainy_River',
  'America/Rankin_Inlet', 'America/Resolute', 'America/Regina', 'America/Swift_Current', 'America/Edmonton',
  'America/Cambridge_Bay', 'America/Yellowknife', 'America/Inuvik', 'America/Vancouver', 'America/Dawson_Creek',
  'America/Fort_Nelson', 'America/Creston', 'America/Whitehorse', 'America/Dawson', 'America/Halifax',
  'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay', 'America/Blanc-Sablon', 'America/St_Johns',
]);

const US_ZONES = new Set([
  'America/New_York', 'America/Detroit', 'America/Chicago', 'America/Menominee', 'America/Denver',
  'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau',
  'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak',
  'America/Indianapolis', 'America/Louisville', 'America/Fort_Wayne', 'America/Knox_IN', 'America/Shiprock',
  'America/Atka', 'Pacific/Honolulu',
]);
const US_ZONE_PREFIXES = ['America/Indiana/', 'America/Kentucky/', 'America/North_Dakota/', 'US/'];

type ZoneVerdict = CrisisRegion | 'AMERICAS' | 'UNKNOWN';

function regionFromTimeZone(tz: string): ZoneVerdict {
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IN';
  if (tz === 'Europe/London' || tz === 'Europe/Belfast' || tz === 'GB') return 'GB';
  if (tz.startsWith('Australia/')) return 'AU';
  if (CA_ZONES.has(tz) || tz.startsWith('Canada/')) return 'CA';
  if (US_ZONES.has(tz) || US_ZONE_PREFIXES.some(p => tz.startsWith(p))) return 'US';
  if (tz.startsWith('America/')) return 'AMERICAS';
  // UTC, Etc/* and empty zones say nothing about where the phone is.
  if (!tz || tz === 'UTC' || tz.startsWith('Etc/')) return 'UNKNOWN';
  return 'OTHER';
}

// Hermes has no Intl.Locale, so read the region subtag by hand:
// en-IN → IN, zh-Hant-TW → TW, en_GB → GB. Stops at extensions (-u-…).
function regionFromLocale(locale: string): string | undefined {
  const parts = locale.split(/[-_]/);
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.length === 1) break;
    if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  }
  return undefined;
}

const SUPPORTED = new Set<CrisisRegion>(['IN', 'US', 'GB', 'CA', 'AU']);

function deviceLocaleAndZone(): { locale: string; timeZone: string } {
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    return { locale: o.locale ?? '', timeZone: o.timeZone ?? '' };
  } catch {
    return { locale: '', timeZone: '' };
  }
}

/**
 * Where the device is, as far as crisis numbers go. The time zone decides when
 * it can (it follows the phone; a language setting does not), the locale's
 * region fills in when the zone is ambiguous, and anything uncertain is OTHER.
 * Pass `device` to evaluate a specific locale and zone.
 */
export function crisisRegion(device: { locale?: string; timeZone?: string } = deviceLocaleAndZone()): CrisisRegion {
  const fromZone = regionFromTimeZone(device.timeZone ?? '');
  const fromLocale = regionFromLocale(device.locale ?? '');
  if (fromZone === 'AMERICAS') {
    // A US or Canadian region in an Americas zone is plausible; the zone alone
    // is not. With no region at all, the Americas default is the US.
    if (fromLocale === 'US' || fromLocale === 'CA') return fromLocale;
    return fromLocale ? 'OTHER' : 'US';
  }
  if (fromZone === 'UNKNOWN') {
    return fromLocale && SUPPORTED.has(fromLocale as CrisisRegion) ? (fromLocale as CrisisRegion) : 'OTHER';
  }
  return fromZone;
}

export function crisisResources(region: CrisisRegion = crisisRegion()): { emergency: CrisisResource; resources: CrisisResource[] } {
  return RESOURCES[region];
}

/** False for an entry that only names what to do (no number or link to open). */
export function canOpenCrisisResource(r: CrisisResource): boolean {
  return r.value !== '';
}

/** The URL a resource opens: tel:, sms: (with its prefilled body), or https:. */
export function crisisResourceUrl(r: CrisisResource, platform: string): string | null {
  if (!canOpenCrisisResource(r)) return null;
  if (r.kind === 'web') return r.value;
  if (r.kind === 'call') return `tel:${r.value}`;
  if (!r.body) return `sms:${r.value}`;
  // iOS reads the body after `&`, everyone else after `?`.
  return `sms:${r.value}${platform === 'ios' ? '&' : '?'}body=${encodeURIComponent(r.body)}`;
}

/**
 * Hands the resource to the phone, dialer or browser. Resolves false when the
 * OS could not open it (an iPad cannot place a call), so the screen can say so
 * and leave the number visible.
 */
export async function openCrisisResource(r: CrisisResource): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Linking, Platform } = require('react-native') as typeof import('react-native');
  const url = crisisResourceUrl(r, Platform.OS);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.warn('[Crisis] could not open', url, e);
    return false;
  }
}
