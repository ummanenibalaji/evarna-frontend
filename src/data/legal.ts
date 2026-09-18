/**
 * The published legal documents: the Terms of Use and the Privacy Policy.
 *
 * One source for every screen that links to them (Settings, the paywall and
 * the sign-in consent line), so they can never point at different places.
 * The URLs are set per build (EXPO_PUBLIC_TERMS_URL, EXPO_PUBLIC_PRIVACY_URL).
 * A document that has not been published is left out rather than linked to a
 * placeholder: the in-app summaries this replaced promised things nobody had
 * checked, at a domain we did not own.
 */
import { Linking } from 'react-native';

export type LegalDocId = 'terms' | 'privacy';

export interface LegalDoc {
  id: LegalDocId;
  /** As it appears on a row or a link. */
  title: string;
  url: string;
}

// Inlined at bundle time, like every EXPO_PUBLIC_ variable.
const clean = (v: string | undefined): string | null => {
  const url = v?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
};

export const TERMS_URL = clean(process.env.EXPO_PUBLIC_TERMS_URL);
export const PRIVACY_URL = clean(process.env.EXPO_PUBLIC_PRIVACY_URL);

const DOCS: { id: LegalDocId; title: string; url: string | null }[] = [
  { id: 'terms', title: 'Terms of Use', url: TERMS_URL },
  { id: 'privacy', title: 'Privacy Policy', url: PRIVACY_URL },
];

/** The documents this build can link to, Terms first. Empty when neither is set. */
export function legalDocs(): LegalDoc[] {
  return DOCS.flatMap(d => (d.url ? [{ id: d.id, title: d.title, url: d.url }] : []));
}

/** One document, or null when it has not been published for this build. */
export function legalDoc(id: LegalDocId): LegalDoc | null {
  return legalDocs().find(d => d.id === id) ?? null;
}

/** Opens the document in the browser. Resolves false when the OS could not open it. */
export async function openLegalDoc(doc: LegalDoc): Promise<boolean> {
  try {
    await Linking.openURL(doc.url);
    return true;
  } catch {
    return false;
  }
}
