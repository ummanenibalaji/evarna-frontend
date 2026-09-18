// Settings.tsx — S21 Settings, S_UserProfile (your own account), S22 Memories
// and S23 Paywall.
//
// Every sheet here is the shared Sheet. The paywall is one itself, and the
// router hosts it above everything. Sheets opened from inside a screen go in
// a transparent Modal (OverlaySheet): the tab bar, toasts and status bar are
// drawn outside the screen, and a Modal is the one layer above all of them,
// so the scrim covers the display and nothing behind a confirmation can be
// tapped.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';

import { Screen, TopBar } from '../components/Chrome';
import { useTabBarHeight } from '../components/BottomNav';
import { NavIcon, type IconName } from '../components/NavIcon';
import { RadialGlow } from '../components/RadialGlow';
import { Sheet, type SheetProps } from '../components/Sheet';
import { Txt } from '../components/Txt';
import {
  BackButton, Card, EmptyState, ErrorState, GlassFill, IconButton, InlineNotice, MeterBar, Pill,
  PrimaryButton, SectionLabel, Skeleton, SkeletonLines, Sparkles, Toggle, minTarget,
} from '../components/Atoms';
import { announce, useScreenReader } from '../hooks/useAccessibilityPrefs';
import { haptic } from '../lib/haptics';
import { enter, exit, layout, usePressFeedback } from '../theme/motion';
import { useCountUp } from '../theme/animations';
import { GRAD, HIT, MOTION, R, SP, TYPE, W, resolveFont, rgba } from '../theme/theme';
import { ApiError, AuthExpiredError, isNetworkError } from '../api/client';
import {
  deleteAllMemories, deleteMemory, exportMyData, getActivity, getMe, getMemories, getUserStats,
  setPushToken, syncEntitlement, updateMe,
  type ApiActivity, type ApiBillingPlan, type ApiEntitlement, type ApiMemory, type ApiUserStats,
} from '../api';
import {
  balanceTone, currentPaidTier, formatBalance, formatResetDate, LOW_BALANCE_SECONDS, minutesFrom,
  planFeatures, resetLabel, savingsPercent,
} from '../lib/entitlement';
import {
  buyPlan, DEVICE_STORE, loadStorePlans, openManageSubscriptions, restorePurchases, storeAvailable,
  storeFailureOf, storeName, type PurchaseOutcome, type StorePlan, type StorePlatform,
} from '../lib/purchases';
import type { PaidTier } from '../lib/storeProducts';
import {
  getDeviceTimezone, getPushPermissionStatus, getPushTokenIfGranted, requestPushPermission,
} from '../lib/notifications';
import { readCache, writeCache } from '../lib/cache';
import { legalDocs, openLegalDoc, type LegalDoc } from '../data/legal';
import { ARCHETYPE_COLORS, ARCHETYPE_LABEL, MEM_TYPES, Companion, Tier } from '../data/config';
import { Go, PaywallTrigger, ScreenName } from '../navigation/types';
import { useTabReselect } from '../navigation/tabEvents';

const D = MOTION.duration;
const FILL = StyleSheet.absoluteFillObject;
const DIAGONAL = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } as const;

// The installed build's own version, not a number typed into the screen.
const APP_VERSION = (() => {
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  if (!version) return 'Unknown';
  return build ? `${version} (${build})` : version;
})();

// Only the documents published for this build; the rows for the others are left out.
const LEGAL_DOCS = legalDocs();

export interface AppSettings {
  /** Proactive check-ins. Saved on the server, which skips outreach when off. */
  dailyCheckin: boolean;
}

type LoadStatus = 'loading' | 'ready' | 'error';
type PushPermission = 'granted' | 'denied' | 'undetermined';

// ─── Small helpers ───────────────────────────────────────────────────────

const isPromise = (v: unknown): v is Promise<unknown> =>
  !!v && typeof (v as { then?: unknown }).then === 'function';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** First character of a name, emoji-safe. */
const initialOf = (s: string) => (Array.from(s.trim())[0] ?? '').toUpperCase();

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const insertAt = <T,>(list: T[], index: number, item: T): T[] =>
  [...list.slice(0, index), item, ...list.slice(index)];

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return alive;
}

function waitLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  const m = Math.ceil(seconds / 60);
  return m === 1 ? 'a minute' : `${m} minutes`;
}

/** The second sentence of a failure message: what went wrong, in plain words. */
function failureCopy(e: unknown): string {
  if (isNetworkError(e)) return "Can't reach Evarna. Check your connection and try again.";
  if (e instanceof ApiError && e.status === 429) {
    return e.retryAfter ? `Too many tries. Try again in ${waitLabel(e.retryAfter)}.` : 'Too many tries. Wait a moment and try again.';
  }
  return 'Please try again in a moment.';
}

/** Minutes as VoiceOver should say them ("formatBalance" abbreviates). */
function spokenBalance(seconds: number): string {
  if (seconds <= 0) return 'no minutes';
  if (seconds < 60) return `${Math.floor(seconds)} seconds`;
  const m = minutesFrom(seconds);
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

// ─── Sheets ──────────────────────────────────────────────────────────────

// Long enough for the Sheet's exit (a D.base timing, or a flick's spring) to
// finish before whatever hosts it goes away.
const SHEET_EXIT_MS = D.slow;

/** Calls `onExited` once a sheet closed through `visible` has had time to animate out. */
function useAfterExit(visible: boolean, onExited?: () => void) {
  const cb = useRef(onExited);
  cb.current = onExited;
  const shown = useRef(visible);
  useEffect(() => {
    if (visible) {
      shown.current = true;
      return;
    }
    if (!shown.current) return;
    const id = setTimeout(() => {
      shown.current = false;
      cb.current?.();
    }, SHEET_EXIT_MS);
    return () => clearTimeout(id);
  }, [visible]);
}

/**
 * The shared Sheet in a transparent Modal, for sheets opened from inside a
 * screen: the tab bar, toasts and status bar are drawn outside the screen, and
 * only a Modal lies above them all.
 */
function OverlaySheet({ visible, ...sheet }: SheetProps) {
  const [hosted, setHosted] = useState(visible);
  if (visible && !hosted) setHosted(true);
  useAfterExit(visible, () => setHosted(false));

  const { onClose, dismissible = true } = sheet;
  return (
    <Modal
      visible={hosted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => { if (dismissible) onClose(); }}
    >
      {/* A Modal is its own root: gestures inside it need their own handler root. */}
      <GestureHandlerRootView style={styles.fill}>
        <Sheet visible={visible} {...sheet} />
      </GestureHandlerRootView>
    </Modal>
  );
}

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  note?: string | null;
  confirmLabel: string;
  tone?: 'danger' | 'neutral';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmSheet({ visible, title, body, note, confirmLabel, tone = 'neutral', busy = false, error, onConfirm, onCancel }: ConfirmSheetProps) {
  const danger = tone === 'danger';
  return (
    <OverlaySheet
      visible={visible}
      onClose={onCancel}
      title={title}
      dismissible={!busy}
      footer={
        <>
          <PrimaryButton
            variant={danger ? 'danger' : 'secondary'}
            loading={busy}
            onPress={onConfirm}
            haptic={danger ? 'warning' : 'medium'}
          >
            {confirmLabel}
          </PrimaryButton>
          <PrimaryButton variant="text" disabled={busy} onPress={onCancel} haptic={false}>Cancel</PrimaryButton>
        </>
      }
    >
      <Txt variant="body" style={styles.sheetBody}>{body}</Txt>
      {note ? <InlineNotice tone="warning" text={note} style={styles.sheetNotice} /> : null}
      {error ? <InlineNotice tone="error" text={error} style={styles.sheetNotice} /> : null}
    </OverlaySheet>
  );
}

function InfoSheet({ visible, title, body, onClose }: { visible: boolean; title: string; body: string; onClose: () => void }) {
  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={<PrimaryButton variant="secondary" onPress={onClose} haptic={false}>Got it</PrimaryButton>}
    >
      <Txt variant="body" style={styles.sheetBody}>{body}</Txt>
    </OverlaySheet>
  );
}

// ─── Grouped rows ────────────────────────────────────────────────────────

function Group({ title, dot, children, notes }: {
  title?: string;
  dot?: string;
  children: React.ReactNode;
  /** Notices that belong to this group, shown under it. */
  notes?: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      {title ? <SectionLabel dot={dot}>{title}</SectionLabel> : null}
      <Card padding={0}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </View>
        ))}
      </Card>
      {notes}
    </View>
  );
}

type RowKind = 'navigate' | 'action' | 'link';

interface RowProps {
  label: string;
  sublabel?: string;
  /** Replaces the icon tile, e.g. a companion's monogram. */
  leading?: React.ReactNode;
  icon?: IconName;
  iconColor?: string;
  /** Right-hand text. */
  value?: string;
  /** Right-hand content that isn't text (a chip, a placeholder)… */
  valueNode?: React.ReactNode;
  /** …and what VoiceOver says for it. */
  valueLabel?: string;
  onPress?: () => void;
  /** navigate: chevron. action: nothing (opens a sheet or runs). link: leaves the app. */
  kind?: RowKind;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  /** Makes the whole row the switch, so the label is the switch's name and the row is its target. */
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  accessibilityHint?: string;
}

function Row({
  label, sublabel, leading, icon, iconColor = W.primary, value, valueNode, valueLabel, onPress,
  kind = 'navigate', danger = false, busy = false, disabled = false, toggle, accessibilityHint,
}: RowProps) {
  const pressable = !!(onPress || toggle);
  const inactive = disabled || busy;
  const spoken = [label, sublabel, toggle ? undefined : value ?? valueLabel].filter(Boolean).join(', ');

  const handlePress = () => {
    if (toggle) {
      haptic.selection();
      toggle.onChange(!toggle.value);
      return;
    }
    onPress?.();
  };

  let trailing: React.ReactNode;
  if (busy) {
    trailing = <ActivityIndicator color={W.text2} />;
  } else if (toggle) {
    // The row carries the switch's name and state; this is only its picture.
    trailing = (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Toggle value={toggle.value} onChange={toggle.onChange} label={label} disabled={inactive} />
      </View>
    );
  } else {
    trailing = (
      <>
        {value != null ? <Txt variant="subhead" numberOfLines={1} style={styles.rowValue}>{value}</Txt> : null}
        {valueNode}
        {onPress && kind === 'navigate' ? <NavIcon name="right" color={W.text3} size={16} /> : null}
        {onPress && kind === 'link' ? <NavIcon name="external" color={W.text3} size={16} /> : null}
      </>
    );
  }

  const body = (
    <>
      {leading ?? (icon ? (
        <View style={[styles.rowIcon, { backgroundColor: rgba(iconColor, 0.14) }]}>
          <NavIcon name={icon} color={iconColor} size={16} />
        </View>
      ) : null)}
      <View style={styles.rowText}>
        <Txt variant="callout" numberOfLines={2} style={{ color: danger ? W.dangerText : W.text }}>{label}</Txt>
        {sublabel ? <Txt variant="footnote" style={styles.rowSub}>{sublabel}</Txt> : null}
      </View>
      <View style={styles.rowTrailing}>{trailing}</View>
    </>
  );

  if (!pressable) {
    return <View accessible accessibilityLabel={spoken} style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole={toggle ? 'switch' : kind === 'link' ? 'link' : 'button'}
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy, checked: toggle ? toggle.value : undefined }}
      android_ripple={{ color: rgba(W.primary, 0.12) }}
      // Rows sit in a scroll view, so they answer with a highlight on release
      // rather than a haptic on touch-down, which would buzz on every scroll.
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null, disabled && !toggle ? styles.dim : null]}
    >
      {body}
    </Pressable>
  );
}

function TextButton({ label, onPress, danger = false, disabled = false, accessibilityHint, style }: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.textButton, pressed ? styles.pressedDim : null, disabled ? styles.dim : null, style]}
    >
      <Txt variant="subhead" weight={600} style={[styles.center, { color: danger ? W.dangerText : W.text2 }]}>{label}</Txt>
    </Pressable>
  );
}

/** An initial in an aurora ring. Decorative: the row or card around it names the person. */
function Monogram({ name, size }: { name: string; size: number }) {
  const inner = size - 4;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, padding: 2, overflow: 'hidden' }}
    >
      <LinearGradient colors={GRAD.aurora} {...DIAGONAL} style={FILL} />
      <View style={[styles.monogramWell, { borderRadius: inner / 2 }]}>
        <Txt font="display" weight={600} maxScale={1.15} style={{ fontSize: Math.round(size * 0.38), color: W.cream }}>
          {initialOf(name) || '·'}
        </Txt>
      </View>
    </View>
  );
}

function TierChip({ tier, label }: { tier: Tier; label: string }) {
  const fill = tier === 'plus' ? W.primary : tier === 'premium' ? W.gold : W.surface3;
  return (
    <View style={[styles.tierChip, { backgroundColor: fill }]}>
      <Txt variant="caption" weight={600} maxScale={1.2} numberOfLines={1} style={{ color: tier === 'free' ? W.text2 : W.onAccent }}>
        {label}
      </Txt>
    </View>
  );
}

// ─── Account actions (shared by Settings and Your profile) ───────────────

/** Why a delete failed. The router rejects with a sentence written for this sheet. */
function deleteFailure(e: unknown): string {
  if (isNetworkError(e) || e instanceof ApiError) return `Your account wasn't deleted. ${failureCopy(e)}`;
  return e instanceof Error && e.message ? e.message : "Your account wasn't deleted. Please try again.";
}

function useAccountSheets({ go, onDeleteAccount, entitlement }: {
  go: Go;
  onDeleteAccount?: () => void | Promise<void>;
  entitlement?: ApiEntitlement | null;
}) {
  const alive = useAlive();
  const [open, setOpen] = useState<'sign-out' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const signOut = () => {
    // The router covers the app with its own "Signing out…" state and then
    // replaces this screen, so the sheet steps aside for it.
    setOpen(null);
    go('login');
  };

  const confirmDelete = async () => {
    if (!onDeleteAccount || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Success signs out and replaces this screen; the sheet stays busy until then.
      await onDeleteAccount();
    } catch (e) {
      if (!alive.current) return;
      setDeleting(false);
      setDeleteError(deleteFailure(e));
      haptic.error();
    }
  };

  // Deleting the account does not stop a store subscription; only the store can.
  const paid = currentPaidTier(entitlement);
  const billedBy: StorePlatform | null =
    entitlement?.platform === 'ios' || entitlement?.platform === 'android' ? entitlement.platform : null;
  let note: string | null = null;
  if (!entitlement) {
    note = "If you pay for a subscription, cancel it in the store you bought it from first. Deleting your account doesn't stop store billing.";
  } else if (paid && entitlement.auto_renew && billedBy) {
    note = `Deleting your account doesn't cancel your ${entitlement.tier_label} subscription. Cancel it in ${storeName(billedBy)} first so you aren't charged again.`;
  }

  const sheets = (
    <>
      <ConfirmSheet
        visible={open === 'sign-out'}
        title="Sign out?"
        body="You can sign back in any time. Your companions and memories stay with your account."
        confirmLabel="Sign out"
        onConfirm={signOut}
        onCancel={() => setOpen(null)}
      />
      <ConfirmSheet
        visible={open === 'delete'}
        tone="danger"
        title="Delete your account?"
        body="This permanently deletes your account, your companions and everything they remember. It can't be undone, and we can't recover any of it."
        note={note}
        confirmLabel="Delete account"
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setOpen(null)}
      />
    </>
  );

  return {
    sheets,
    canDelete: !!onDeleteAccount,
    openSignOut: () => setOpen('sign-out'),
    openDelete: () => {
      setDeleteError(null);
      setOpen('delete');
    },
  };
}

// ─── S21 SETTINGS ────────────────────────────────────────────────────────
interface SettingsProps {
  go: Go;
  /**
   * What the account is entitled to, or null while it is still loading. Null
   * and `entitlementFailed` are different states and must look different:
   * "we could not read your plan" must never render as "you are on Free".
   */
  entitlement?: ApiEntitlement | null;
  entitlementFailed?: boolean;
  /** Re-reads the entitlement. Returning its promise lets the row show it working. */
  onRetryEntitlement?: () => void | Promise<unknown>;
  companions: Companion[];
  userName: string;
  userEmail: string;
  settings: AppSettings;
  /** Saves the settings. Return the save's promise and a failure is shown here. */
  setSettings: (s: AppSettings) => void | Promise<unknown>;
  openCompanionProfile?: (c: Companion) => void;
  userId?: string;
  // Deletes the account server-side, then signs out. Owned by App.tsx.
  onDeleteAccount?: () => void | Promise<void>;
}

const STATS_KEY = 'settings.stats';
const ACTIVITY_KEY = 'settings.activity';

// Hands the server this device's push token, which it needs to deliver check-ins.
function registerPushToken(token?: string | null) {
  const upload = (t: string | null) => { if (t) setPushToken(t, getDeviceTimezone()).catch(() => {}); };
  if (token !== undefined) upload(token);
  else getPushTokenIfGranted().then(upload).catch(() => {});
}

const ABOUT_BODY =
  'Your companions are AI. They learn from your conversations and keep memories, which you can review or forget any time in Memories.\n\n' +
  "They're here to talk. They can't give medical, legal or financial advice, and they aren't a crisis service. If you're struggling, Crisis support lists people who can help.";

export function S21_Settings({
  go, entitlement, entitlementFailed = false, onRetryEntitlement, companions, userName, userEmail,
  settings, setSettings, openCompanionProfile, userId, onDeleteAccount,
}: SettingsProps) {
  const insets = useSafeAreaInsets();
  const tabBarH = useTabBarHeight();
  const alive = useAlive();

  // A second tap on the Settings tab scrolls back to the top.
  const scrollRef = useRef<ScrollView>(null);
  useTabReselect('settings', () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  // ── Activity: the last known numbers at once, then the fresh ones ──────
  const [stats, setStats] = useState<ApiUserStats | null>(null);
  const [activity, setActivity] = useState<ApiActivity | null>(null);
  const [statsStatus, setStatsStatus] = useState<LoadStatus>('loading');
  const [statsError, setStatsError] = useState<unknown>(null);

  const loadStats = useCallback(async () => {
    if (!userId) return;
    setStatsStatus('loading');
    const [s, a] = await Promise.allSettled([getUserStats(), getActivity()]);
    if (!alive.current) return;
    if (s.status === 'fulfilled') {
      setStats(s.value);
      void writeCache(userId, STATS_KEY, s.value);
    }
    if (a.status === 'fulfilled') {
      setActivity(a.value);
      void writeCache(userId, ACTIVITY_KEY, a.value);
    }
    const failure: unknown = s.status === 'rejected' ? s.reason : a.status === 'rejected' ? a.reason : null;
    setStatsError(failure);
    setStatsStatus(failure ? 'error' : 'ready');
  }, [userId, alive]);

  useEffect(() => {
    if (!userId) return;
    Promise.all([readCache<ApiUserStats>(userId, STATS_KEY), readCache<ApiActivity>(userId, ACTIVITY_KEY)])
      .then(([s, a]) => {
        if (!alive.current) return;
        if (s) setStats(prev => prev ?? s);
        if (a) setActivity(prev => prev ?? a);
      });
    void loadStats();
  }, [userId, loadStats, alive]);

  // This tab stays mounted, so it can't count on a fresh mount after a call.
  // The router re-reads usage after calls and on return to the app; when that
  // changes, the streak and talk time are worth re-reading too.
  const usage = entitlement ? `${entitlement.voice.used_seconds}:${entitlement.text.used_today}` : null;
  const lastUsage = useRef(usage);
  useEffect(() => {
    if (usage === null || usage === lastUsage.current) return;
    const first = lastUsage.current === null;
    lastUsage.current = usage;
    if (!first) void loadStats();
  }, [usage, loadStats]);

  // ── Notification permission, re-read whenever the app comes back ──────
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const lastPermission = useRef<PushPermission | null>(null);

  const refreshPermission = useCallback(async (): Promise<PushPermission> => {
    const next = await getPushPermissionStatus();
    // Allowed in the Settings app while we were away: without its token the
    // server still has nowhere to send check-ins.
    if (next === 'granted' && lastPermission.current && lastPermission.current !== 'granted') registerPushToken();
    lastPermission.current = next;
    if (alive.current) setPermission(next);
    return next;
  }, [alive]);

  useEffect(() => {
    void refreshPermission();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void refreshPermission(); });
    return () => sub.remove();
  }, [refreshPermission]);

  // ── Daily check-in ─────────────────────────────────────────────────────
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const denied = permission === 'denied';
  // The switch shows what will actually happen: nothing arrives while iOS blocks it.
  const checkinOn = settings.dailyCheckin && !denied;

  const askPermission = async (): Promise<PushPermission> => {
    const token = await requestPushPermission();
    registerPushToken(token);
    // Read directly rather than through refreshPermission, which would upload the token a second time.
    const next = await getPushPermissionStatus();
    lastPermission.current = next;
    if (alive.current) setPermission(next);
    return next;
  };

  const saveCheckin = async (on: boolean) => {
    try {
      await setSettings({ ...settings, dailyCheckin: on });
    } catch (e) {
      if (!alive.current) return;
      setCheckinError(`Couldn't save your check-in setting. ${failureCopy(e)}`);
      haptic.error();
    }
  };

  const changeCheckin = async (on: boolean) => {
    if (checkinBusy) return;
    setCheckinError(null);
    if (on && permission !== 'granted') {
      // Turning check-ins on is the moment to ask. A refusal leaves them off,
      // and the notice under the row explains how to change it later.
      setCheckinBusy(true);
      const now = await askPermission();
      if (!alive.current) return;
      setCheckinBusy(false);
      if (now === 'denied') return;
    }
    void saveCheckin(on);
  };

  // ── Data export ────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const data = await exportMyData();
      if (!alive.current) return;
      await shareExport(data);
    } catch (e) {
      if (!alive.current) return;
      setExportError(e instanceof ExportTooLargeError ? e.message : `Couldn't prepare your data. ${failureCopy(e)}`);
    } finally {
      if (alive.current) setExporting(false);
    }
  };

  // ── Plan ───────────────────────────────────────────────────────────────
  const [planRetrying, setPlanRetrying] = useState(false);
  const retryPlan = async () => {
    if (!onRetryEntitlement || planRetrying) return;
    setPlanRetrying(true);
    await Promise.resolve(onRetryEntitlement()).catch(() => {});
    if (alive.current) setPlanRetrying(false);
  };
  const resetDate = entitlement ? formatResetDate(entitlement.period.renews_at) : '';

  // ── Pull to refresh ────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([loadStats(), Promise.resolve(onRetryEntitlement?.()), refreshPermission()]);
    if (alive.current) setRefreshing(false);
  };

  // ── About ──────────────────────────────────────────────────────────────
  const [aboutOpen, setAboutOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const openDoc = async (doc: LegalDoc) => {
    setLinkError(null);
    if (!(await openLegalDoc(doc)) && alive.current) {
      setLinkError(`Couldn't open the ${doc.title}. You can read it at ${doc.url}`);
    }
  };

  const account = useAccountSheets({ go, onDeleteAccount, entitlement });
  const paidTier = currentPaidTier(entitlement);
  const onlyCompanion = companions.length === 1 ? companions[0] : null;

  let planRow: React.ReactNode;
  if (entitlement) {
    planRow = (
      <Row
        icon="flash" iconColor={W.primary} label="Current plan"
        valueNode={<TierChip tier={entitlement.tier} label={entitlement.tier_label} />}
        valueLabel={entitlement.tier_label}
        onPress={() => go('paywall')}
        accessibilityHint="Shows plans and prices"
      />
    );
  } else if (entitlementFailed) {
    planRow = (
      <Row
        icon="flash" iconColor={W.primary} label="Current plan" value="Couldn't load"
        onPress={onRetryEntitlement ? retryPlan : undefined} kind="action" busy={planRetrying}
        accessibilityHint="Tries again"
      />
    );
  } else {
    planRow = (
      <Row
        icon="flash" iconColor={W.primary} label="Current plan"
        valueNode={<Skeleton width={56} height={20} radius={R.sm} />} valueLabel="Loading"
        onPress={() => go('paywall')}
      />
    );
  }

  return (
    <Screen tabBar>
      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={[styles.settingsContent, { paddingBottom: tabBarH + SP.xl }]}
        scrollIndicatorInsets={{ bottom: Math.max(0, tabBarH - insets.bottom) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={W.text2} colors={[W.primary]} progressBackgroundColor={W.surface2} />
        }
      >
        <Txt variant="title1" heading style={styles.largeTitle}>Settings</Txt>

        <ProfileCard
          name={userName}
          email={userEmail}
          tier={paidTier}
          tierLabel={paidTier && entitlement ? entitlement.tier_label : null}
          onPress={() => go('user-profile')}
        />

        {userId ? (
          <StatsHero
            status={statsStatus}
            error={statsError}
            stats={stats}
            activity={activity}
            entitlement={entitlement ?? null}
            entitlementFailed={entitlementFailed}
            onRetry={() => { void loadStats(); }}
            onSeePlans={() => go('paywall')}
          />
        ) : null}

        {companions.length > 0 ? (
          <Group title="My companions">
            {companions.map(c => (
              <Row
                key={String(c.id)}
                label={c.name}
                sublabel={ARCHETYPE_LABEL[c.archetype]}
                leading={<CompanionMark name={c.name} color={ARCHETYPE_COLORS[c.archetype] || W.primary} />}
                onPress={() => (openCompanionProfile ? openCompanionProfile(c) : go('profile'))}
                accessibilityHint="Opens their profile"
              />
            ))}
          </Group>
        ) : null}

        <Group
          title="Notifications"
          dot={W.coral}
          notes={
            <>
              {denied ? (
                <InlineNotice
                  tone="warning"
                  text="Notifications are off for Evarna, so check-ins can't reach you."
                  actionLabel="Open Settings"
                  onAction={() => { Linking.openSettings().catch(() => {}); }}
                />
              ) : permission === 'undetermined' && settings.dailyCheckin ? (
                <InlineNotice
                  tone="info"
                  text="Allow notifications so check-ins can reach you."
                  actionLabel="Allow"
                  onAction={() => { void askPermission(); }}
                />
              ) : null}
              {checkinError ? <InlineNotice tone="error" text={checkinError} /> : null}
            </>
          }
        >
          <Row
            icon="bell" iconColor={W.coral}
            label="Daily check-in"
            sublabel="Your companions can reach out to see how you're doing"
            toggle={{ value: checkinOn, onChange: (v) => { void changeCheckin(v); } }}
            disabled={denied}
            busy={checkinBusy}
          />
        </Group>

        <Group title="Memories" dot={W.gold}>
          <Row
            icon="sparkle-solid" iconColor={W.gold}
            label="Memories"
            sublabel={onlyCompanion ? `What ${onlyCompanion.name} remembers about you` : 'What your companion remembers about you'}
            // The server's count spans every companion; it only matches the
            // list this opens when there is one companion.
            value={onlyCompanion && stats ? String(stats.total_memories) : undefined}
            onPress={() => go('memories')}
            accessibilityHint="Review or forget memories"
          />
        </Group>

        <Group title="Subscription">
          {planRow}
          {entitlement && resetDate ? (
            <Row icon="clock" iconColor={W.text2} label={resetLabel(entitlement)} value={resetDate} />
          ) : null}
        </Group>

        <Group
          title="Privacy & safety"
          notes={exportError ? (
            <InlineNotice tone="error" text={exportError} actionLabel="Try again" onAction={() => { void exportData(); }} />
          ) : null}
        >
          <Row
            icon="share" iconColor={W.secondary}
            label="Export my data"
            sublabel="A copy of your account, companions and memories"
            onPress={() => { void exportData(); }}
            kind="action"
            busy={exporting}
            accessibilityHint={Platform.OS === 'ios' ? 'Prepares a file you can save or share' : 'Opens the share sheet with your data'}
          />
          <Row
            icon="heart" iconColor={W.rose}
            label="Crisis support"
            sublabel="Helplines and emergency numbers"
            onPress={() => go('crisis')}
          />
        </Group>

        <Group title="Account">
          <Row label="Sign out" onPress={account.openSignOut} kind="action" accessibilityHint="Asks you to confirm first" />
          {account.canDelete ? (
            <Row label="Delete account" danger onPress={account.openDelete} kind="action" accessibilityHint="Asks you to confirm first" />
          ) : null}
        </Group>

        <Group title="About" notes={linkError ? <InlineNotice tone="error" text={linkError} /> : null}>
          <Row label="How Evarna works" onPress={() => setAboutOpen(true)} kind="action" />
          {LEGAL_DOCS.map(doc => (
            <Row key={doc.id} label={doc.title} onPress={() => { void openDoc(doc); }} kind="link" accessibilityHint="Opens in your browser" />
          ))}
          <Row label="Version" value={APP_VERSION} />
        </Group>
      </ScrollView>

      <InfoSheet visible={aboutOpen} title="How Evarna works" body={ABOUT_BODY} onClose={() => setAboutOpen(false)} />
      {account.sheets}
    </Screen>
  );
}

function ProfileCard({ name, email, tier, tierLabel, onPress }: {
  name: string;
  email: string;
  tier: PaidTier | null;
  tierLabel: string | null;
  onPress: () => void;
}) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle, haptic: false });
  const shown = name.trim();
  const spoken = [shown || 'Your profile', tierLabel ? `${tierLabel} plan` : null, email || 'No email linked'].filter(Boolean).join(', ');
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Edit your name and how your companions talk with you"
      >
        <Card>
          <View style={styles.profileRow}>
            <Monogram name={shown} size={52} />
            <View style={styles.flexShrink}>
              <View style={styles.profileNameRow}>
                <Txt variant="headline" numberOfLines={1} style={styles.profileName}>{shown || 'Your profile'}</Txt>
                {tier && tierLabel ? <TierChip tier={tier} label={tierLabel} /> : null}
              </View>
              <Txt variant="footnote" numberOfLines={1} style={styles.muted}>{email || 'No email linked'}</Txt>
            </View>
            <NavIcon name="right" color={W.text3} size={16} />
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
}

function CompanionMark({ name, color }: { name: string; color: string }) {
  return (
    <View style={[styles.companionMark, { backgroundColor: rgba(color, 0.16), borderColor: rgba(color, 0.4) }]}>
      <Txt font="comp" weight={700} maxScale={1.15} style={{ fontSize: 14, color }}>{initialOf(name) || '·'}</Txt>
    </View>
  );
}

// ─── Data export ─────────────────────────────────────────────────────────

class ExportTooLargeError extends Error {}

// Android passes shared text to the target app in one binder transaction,
// which fails at about 1 MB; this leaves room for the rest of the intent.
const ANDROID_SHARE_TEXT_LIMIT = 500_000;

function writeExportFile(json: string): File | null {
  try {
    const file = new File(Paths.cache, `evarna-data-${new Date().toISOString().slice(0, 10)}.json`);
    file.create({ overwrite: true });
    file.write(json);
    return file;
  } catch {
    return null; // No writable cache: fall back to sharing the text itself.
  }
}

/** The export as a readable JSON file on iOS (Save to Files, AirDrop, Mail), or as text on Android. */
async function shareExport(data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const title = 'Your Evarna data';
  if (Platform.OS === 'ios') {
    const file = writeExportFile(json);
    if (file) {
      try {
        await Share.share({ url: file.uri, title });
      } finally {
        // It holds everything about the account; don't leave it in the cache.
        try { file.delete(); } catch { /* the system clears the cache anyway */ }
      }
      return;
    }
  } else if (json.length > ANDROID_SHARE_TEXT_LIMIT) {
    throw new ExportTooLargeError('Your data is too large to share as text from this phone.');
  }
  await Share.share({ title, message: json });
}

// ─── StatsHero — streak, talk time and voice balance ─────────────────────
// The streak ring is the emotional anchor of this screen, so it gets the only
// arc in the app: an aurora sweep whose length is the progress toward the
// personal best.

// A count-up is a first-look flourish, not something to replay on every visit.
let statsCountedThisSession = false;

const HERO_WASH = [rgba(W.primary, 0.16), rgba(W.surface1, 0.5), rgba(W.bg, 0.85)] as const;
const GOLD_GLOW = [
  { offset: 0, color: W.gold, opacity: 0.18 },
  { offset: 1, color: W.gold, opacity: 0 },
] as const;
const VIOLET_GLOW = [
  { offset: 0, color: W.violet, opacity: 0.2 },
  { offset: 1, color: W.violet, opacity: 0 },
] as const;

interface StatsHeroProps {
  status: LoadStatus;
  error: unknown;
  stats: ApiUserStats | null;
  activity: ApiActivity | null;
  entitlement: ApiEntitlement | null;
  entitlementFailed: boolean;
  onRetry: () => void;
  onSeePlans: () => void;
}

function StatsHero({ status, error, stats, activity, entitlement, entitlementFailed, onRetry, onSeePlans }: StatsHeroProps) {
  const { width, fontScale } = useWindowDimensions();
  const [countUp] = useState(() => !statsCountedThisSession);
  const known = stats != null || activity != null;
  useEffect(() => { if (known) statsCountedThisSession = true; }, [known]);

  const streak = activity?.streak_days ?? 0;
  const best = Math.max(activity?.best_streak ?? 0, streak);
  const talk = Math.round(stats?.total_voice_minutes ?? 0);
  const streakN = useCountUp(streak, countUp ? 1100 : 0, countUp ? 200 : 0);
  const talkN = useCountUp(talk, countUp ? 1500 : 0, countUp ? 300 : 0);

  if (!known) {
    if (status === 'error') {
      return <InlineNotice tone="error" text={`Couldn't load your activity. ${failureCopy(error)}`} actionLabel="Retry" onAction={onRetry} />;
    }
    return <HeroSkeleton />;
  }

  const stack = width < 350 || fontScale >= 1.3;
  const shownStreak = countUp ? streakN : streak;
  const shownTalk = countUp ? talkN : talk;

  // Monday-first, bucketed by the server in the user's own zone.
  const todayIndex = (new Date().getDay() + 6) % 7;
  const talkedToday = (activity?.week_minutes?.[todayIndex] ?? 0) > 0;
  const streakHint = !activity ? null
    : talkedToday ? "You've talked today"
    : streak > 0 ? 'Talk today to keep it going'
    : 'Talk today to start a streak';
  const streakSpoken = activity
    ? `Current streak, ${streak} ${streak === 1 ? 'day' : 'days'}. Best ${best}.${streakHint ? ` ${streakHint}.` : ''}`
    : 'Current streak unavailable';

  const firstWeek = activity != null && activity.active_days === 0;
  const delta = activity ? activity.week_total_minutes - activity.prev_week_total_minutes : null;
  const deltaText = delta === null || firstWeek ? null
    : delta === 0 ? 'Same as last week'
    : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} min vs last week`;
  const deltaSpoken = delta === null || firstWeek ? ''
    : delta === 0 ? ' Same as last week.'
    : ` ${Math.abs(delta)} minutes ${delta > 0 ? 'more' : 'less'} than last week.`;
  const hours = Math.floor(shownTalk / 60);
  const mins = shownTalk % 60;
  const talkSpoken = stats
    ? `Talk time, ${Math.floor(talk / 60)} hours ${talk % 60} minutes.${firstWeek ? ' Your first week starts today.' : deltaSpoken}`
    : 'Talk time unavailable';

  return (
    <View>
      <View style={styles.hero}>
        <GlassFill intensity={30} solid={W.surface1} />
        <LinearGradient pointerEvents="none" colors={HERO_WASH} locations={[0, 0.55, 1]} {...DIAGONAL} style={FILL} />
        <RadialGlow width={220} height={220} stops={GOLD_GLOW} style={styles.heroGlowGold} />
        <RadialGlow width={200} height={200} stops={VIOLET_GLOW} style={styles.heroGlowViolet} />
        <View pointerEvents="none" style={styles.heroEdge} />

        <View style={styles.heroBody}>
          <View accessible accessibilityLabel={streakSpoken} style={styles.streakRow}>
            <StreakRing progress={best > 0 ? streak / best : 0} />
            <View style={styles.flexShrink}>
              <Txt variant="eyebrow" style={{ color: W.gold }}>Current streak</Txt>
              <View style={styles.baselineRow}>
                <Txt variant="numeral" style={{ color: W.cream }}>{activity ? shownStreak : '—'}</Txt>
                {activity ? <Txt variant="subhead" weight={500} style={styles.muted}>{streak === 1 ? 'day' : 'days'}</Txt> : null}
                {activity ? <Txt variant="footnote" style={styles.bestLabel}>best {best}</Txt> : null}
              </View>
              {streakHint ? <Txt variant="footnote" style={styles.muted}>{streakHint}</Txt> : null}
            </View>
          </View>

          <View style={styles.heroDivider} />

          <View style={[styles.heroStats, stack ? styles.heroStatsStacked : null]}>
            <View accessible accessibilityLabel={talkSpoken} style={styles.heroStat}>
              <View style={styles.statLabelRow}>
                <View style={[styles.statDot, { backgroundColor: W.violet }]} />
                <Txt variant="eyebrow" style={styles.muted}>Talk time</Txt>
              </View>
              {stats ? (
                <View style={styles.baselineRow}>
                  {hours > 0 ? (
                    <>
                      <Txt variant="numeral" style={styles.statNumber}>{hours}</Txt>
                      <Txt variant="footnote" weight={500} style={styles.muted}>h</Txt>
                    </>
                  ) : null}
                  <Txt variant="numeral" style={styles.statNumber}>{mins}</Txt>
                  <Txt variant="footnote" weight={500} style={styles.muted}>m</Txt>
                </View>
              ) : (
                <Txt variant="numeral" style={styles.statNumber}>—</Txt>
              )}
              {firstWeek ? (
                <Txt variant="footnote" style={{ color: W.gold }}>Your first week starts today</Txt>
              ) : (
                <>
                  {activity ? <Sparkline data={activity.week_minutes} color={W.gold} /> : null}
                  {deltaText ? <Txt variant="footnote" weight={500} style={{ color: W.gold }}>{deltaText}</Txt> : null}
                </>
              )}
            </View>

            {entitlement ? (
              <VoiceBalance entitlement={entitlement} onSeePlans={onSeePlans} />
            ) : entitlementFailed ? null : (
              <View style={styles.heroStat} accessible accessibilityLabel="Voice balance loading">
                <Skeleton width={72} height={11} />
                <Skeleton width={88} height={24} />
                <Skeleton height={6} />
              </View>
            )}
          </View>
        </View>
      </View>
      {status === 'error' ? (
        <InlineNotice
          tone="warning"
          text={`Couldn't refresh your activity. ${failureCopy(error)}`}
          actionLabel="Retry"
          onAction={onRetry}
          style={styles.heroNotice}
        />
      ) : null}
    </View>
  );
}

function VoiceBalance({ entitlement, onSeePlans }: { entitlement: ApiEntitlement; onSeePlans: () => void }) {
  const v = entitlement.voice;
  const tone = balanceTone(v.remaining_seconds);
  const color = tone === 'empty' ? W.dangerText : tone === 'low' ? W.warning : W.cream;
  const allowanceMin = minutesFrom(v.allowance_seconds);
  const reset = formatResetDate(entitlement.period.renews_at);
  const lowAt = v.allowance_seconds > 0 ? Math.min(1, LOW_BALANCE_SECONDS / v.allowance_seconds) : undefined;
  const spoken = `Voice left, ${spokenBalance(v.remaining_seconds)} of ${allowanceMin} minutes.${reset ? ` Resets ${reset}.` : ''}`;
  return (
    <View style={styles.heroStat}>
      <View accessible accessibilityLabel={spoken} style={styles.heroStatInner}>
        <View style={styles.statLabelRow}>
          <View style={[styles.statDot, { backgroundColor: W.primary }]} />
          <Txt variant="eyebrow" style={styles.muted}>Voice left</Txt>
        </View>
        <Txt variant="numeral" style={[styles.statNumber, { color }]}>{formatBalance(v.remaining_seconds)}</Txt>
        <MeterBar
          pct={v.allowance_seconds > 0 ? v.remaining_seconds / v.allowance_seconds : 0}
          lowAt={lowAt}
          accessibilityLabel="Voice minutes left"
        />
        <Txt variant="footnote" style={styles.muted}>
          {`of ${allowanceMin} min${reset ? ` · resets ${reset}` : ''}`}
        </Txt>
      </View>
      {tone !== 'ok' && entitlement.tier !== 'premium' ? (
        <TextButton label="See plans" onPress={onSeePlans} style={styles.seePlans} accessibilityHint="Shows plans with more voice minutes" />
      ) : null}
    </View>
  );
}

function HeroSkeleton() {
  return (
    <View style={styles.hero} accessible accessibilityLabel="Loading your activity" accessibilityState={{ busy: true }}>
      <GlassFill intensity={30} solid={W.surface1} />
      <View style={styles.heroBody}>
        <View style={styles.streakRow}>
          <Skeleton width={RING} height={RING} radius={RING / 2} />
          <View style={styles.skeletonStack}>
            <Skeleton width={96} height={11} />
            <Skeleton width={120} height={28} />
            <Skeleton width={150} height={12} />
          </View>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Skeleton width={72} height={11} />
            <Skeleton width={88} height={24} />
            <Skeleton height={20} />
          </View>
          <View style={styles.heroStat}>
            <Skeleton width={72} height={11} />
            <Skeleton width={88} height={24} />
            <Skeleton height={6} />
          </View>
        </View>
      </View>
    </View>
  );
}

const RING = 74;

// Drawn as a dashed stroke so its length tracks progress toward the personal
// best, with the flame sitting in the well.
function StreakRing({ progress }: { progress: number }) {
  const stroke = 6;
  const r = (RING - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  // Any streak at all gets a visible start to the arc.
  const filled = p > 0 ? Math.max(0.04, p) * circumference : 0;
  return (
    <View style={styles.ring}>
      <Svg width={RING} height={RING} style={styles.ringSvg}>
        <Defs>
          <SvgLinearGradient id="streakArc" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={W.coral} />
            <Stop offset="0.55" stopColor={W.rose} />
            <Stop offset="1" stopColor={W.violet} />
          </SvgLinearGradient>
        </Defs>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={rgba(W.text, 0.08)} strokeWidth={stroke} fill="none" />
        {filled > 0 ? (
          <Circle
            cx={RING / 2} cy={RING / 2} r={r}
            stroke="url(#streakArc)" strokeWidth={stroke} fill="none"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            // Start the sweep at 12 o'clock rather than 3 o'clock.
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        ) : null}
      </Svg>
      <View style={styles.ringWell}>
        <FlameIcon />
      </View>
    </View>
  );
}

function FlameIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4-1 2 1 3 2 3 0-3-2-4-2-6 0-1 1-2 3-2z" fill={W.gold} stroke={W.coral} strokeWidth={1.2} strokeLinejoin="round" />
      <Path d="M12 12s2 1.5 2 4a2 2 0 0 1-4 0c0-1 .5-1.5 1-2 0 1 1 1.5 1 1.5 0-1.5-1-2.5-1-3 0-.5.5-1 1-.5z" fill={W.cream} opacity={0.85} />
    </Svg>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const [w, setW] = useState(0);
  const h = 24;
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const stepX = w > 0 ? w / (data.length - 1) : 0;
  const pts = data.map((d, i) => `${(i * stepX).toFixed(1)},${(h - (d / max) * (h - 4) - 2).toFixed(1)}`);
  const lastX = (data.length - 1) * stepX;
  const lastY = h - (data[data.length - 1] / max) * (h - 4) - 2;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.sparkline}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Path d={`M ${pts.join(' L ')}`} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={`M 0,${h} L ${pts.join(' L ')} L ${lastX},${h} Z`} fill={color} fillOpacity={0.15} />
          <Circle cx={lastX} cy={lastY} r={1.5} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}

// ─── S_UserProfile — your own account (separate from companion edit) ─────

interface Option { value: string; label: string }

// The values the backend accepts (PATCH /users/me). Gender is what the
// companions use for your pronouns, so it is shown as pronouns, as on S05.
const PRONOUNS: Option[] = [
  { value: 'female', label: 'She/her' },
  { value: 'male', label: 'He/him' },
  { value: 'nonbinary', label: 'They/them' },
  { value: 'undisclosed', label: 'Prefer not to say' },
];
const STYLES: Option[] = [
  { value: 'warm', label: 'Warm & gentle' },
  { value: 'direct', label: 'Direct & honest' },
  { value: 'funny', label: 'Funny & light' },
  { value: 'calm', label: 'Calm & slow' },
];

// Onboarding used to send the hyphenated form.
const normalizeGender = (g: string | null) => (g === 'non-binary' ? 'nonbinary' : g);

interface UserPrefs { gender: string | null; communication_style: string | null }
type PickerKind = 'pronouns' | 'style';
type NameState = 'idle' | 'saving' | 'saved' | 'error' | 'empty';

interface UserProfileProps {
  go: Go;
  userName: string;
  userEmail: string;
  /** Saves the display name. Return the save's promise to show Saved or the failure here. */
  onSave?: (p: { display_name?: string }) => void | Promise<unknown>;
  onDeleteAccount?: () => void | Promise<void>;
  backTo?: ScreenName;
}

export function S_UserProfile({ go, userName, userEmail, onSave, onDeleteAccount, backTo = 'settings' }: UserProfileProps) {
  const alive = useAlive();

  // ── Name ──────────────────────────────────────────────────────────────
  const [name, setName] = useState(userName);
  const [savedName, setSavedName] = useState(userName);
  const [nameState, setNameState] = useState<NameState>('idle');
  const nameRef = useRef(name);
  nameRef.current = name;
  const savedRef = useRef(savedName);
  savedRef.current = savedName;
  // Back and the field losing focus can both ask to save the same edit.
  const submitted = useRef<string | null>(null);

  // Follow the router's copy (it can change after a save, or be put back after
  // a failed one) unless the field holds an edit of its own.
  useEffect(() => {
    if (nameRef.current.trim() === savedRef.current.trim()) setName(userName);
    setSavedName(userName);
  }, [userName]);

  const saveName = async () => {
    const next = name.trim();
    if (!next) {
      setName(savedName);
      setNameState('empty');
      return;
    }
    if (next === savedName.trim()) {
      if (next !== name) setName(next);
      return;
    }
    if (!onSave || submitted.current === next) return;
    submitted.current = next;
    const previous = savedName;
    setName(next);
    setSavedName(next);
    setNameState('saving');
    try {
      const pending = onSave({ display_name: next });
      if (!isPromise(pending)) {
        // Nothing to wait for, so nothing honest to confirm.
        setNameState('idle');
        return;
      }
      await pending;
      if (!alive.current) return;
      setNameState('saved');
      announce('Name saved');
    } catch {
      // The router says why, with a Retry, and puts its copy of the name back;
      // the field only records that this edit didn't stick.
      submitted.current = null;
      if (!alive.current) return;
      setSavedName(previous);
      setNameState('error');
    }
  };

  const leave = () => {
    // Same save-on-back as before, for an edit that never left the field.
    if (name.trim() && name.trim() !== savedName.trim()) void saveName();
    go(backTo);
  };

  // ── Pronouns and conversation style ───────────────────────────────────
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [prefsStatus, setPrefsStatus] = useState<LoadStatus>('loading');
  const [prefsError, setPrefsError] = useState<unknown>(null);

  const loadPrefs = useCallback(async () => {
    setPrefsStatus('loading');
    try {
      const me = await getMe();
      if (!alive.current) return;
      setPrefs({ gender: me.gender ?? null, communication_style: me.communication_style ?? null });
      setPrefsStatus('ready');
    } catch (e) {
      if (!alive.current) return;
      setPrefsError(e);
      setPrefsStatus('error');
    }
  }, [alive]);
  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  const [picker, setPicker] = useState<PickerKind | null>(null);
  // Kept after closing, so the sheet's content doesn't change while it animates out.
  const [pickerKind, setPickerKind] = useState<PickerKind>('pronouns');
  const [savingValue, setSavingValue] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const openPicker = (kind: PickerKind) => {
    setPickerKind(kind);
    setPickerError(null);
    setPicker(kind);
  };

  const pronounValue = normalizeGender(prefs?.gender ?? null);
  const styleValue = prefs?.communication_style ?? null;
  const labelOf = (options: Option[], v: string | null) => options.find(o => o.value === v)?.label ?? 'Not set';

  const choose = async (value: string) => {
    if (!prefs || savingValue) return;
    const current = pickerKind === 'pronouns' ? pronounValue : styleValue;
    if (current === value) {
      setPicker(null);
      return;
    }
    setSavingValue(value);
    setPickerError(null);
    try {
      await (pickerKind === 'pronouns' ? updateMe({ gender: value }) : updateMe({ communication_style: value }));
      if (!alive.current) return;
      setPrefs(p => (p ? (pickerKind === 'pronouns' ? { ...p, gender: value } : { ...p, communication_style: value }) : p));
      haptic.selection();
      announce(`${labelOf(pickerKind === 'pronouns' ? PRONOUNS : STYLES, value)} saved`);
      setPicker(null);
    } catch (e) {
      if (!alive.current) return;
      setPickerError(`Couldn't save that. ${failureCopy(e)}`);
      haptic.error();
    } finally {
      if (alive.current) setSavingValue(null);
    }
  };

  const account = useAccountSheets({ go, onDeleteAccount });

  const prefValue = (options: Option[], v: string | null) =>
    prefsStatus === 'ready'
      ? { value: labelOf(options, v) }
      : prefsStatus === 'loading'
        ? { valueNode: <Skeleton width={72} height={14} />, valueLabel: 'Loading' }
        : { value: '—', valueLabel: 'Unavailable' };

  const shownName = name.trim() || savedName.trim();

  return (
    <Screen>
      <TopBar left={<BackButton onPress={leave} />} title="Your profile" focusTitleOnMount />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.profileContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileHero}>
          <Monogram name={shownName} size={88} />
          {shownName ? <Txt variant="title2" numberOfLines={2} style={styles.center}>{shownName}</Txt> : null}
        </View>

        <Group title="Profile">
          <NameField
            value={name}
            onChangeText={v => {
              setName(v);
              if (nameState !== 'saving') setNameState('idle');
            }}
            onCommit={() => { void saveName(); }}
            state={nameState}
          />
          <FieldRow
            label="Email"
            value={userEmail || 'Not linked'}
            note={userEmail ? "Used to sign in. It can't be changed here." : undefined}
          />
        </Group>

        <Group
          title="Conversations"
          notes={prefsStatus === 'error' ? (
            <InlineNotice
              tone="error"
              text={`Couldn't load your preferences. ${failureCopy(prefsError)}`}
              actionLabel="Retry"
              onAction={() => { void loadPrefs(); }}
            />
          ) : null}
        >
          <Row
            label="Pronouns"
            sublabel="How your companions refer to you"
            {...prefValue(PRONOUNS, pronounValue)}
            onPress={() => openPicker('pronouns')}
            disabled={prefsStatus !== 'ready'}
            kind="action"
          />
          <Row
            label="Conversation style"
            sublabel="How your companions talk with you"
            {...prefValue(STYLES, styleValue)}
            onPress={() => openPicker('style')}
            disabled={prefsStatus !== 'ready'}
            kind="action"
          />
        </Group>

        <Group title="Account">
          <Row label="Sign out" onPress={account.openSignOut} kind="action" accessibilityHint="Asks you to confirm first" />
          {account.canDelete ? (
            <Row label="Delete account" danger onPress={account.openDelete} kind="action" accessibilityHint="Asks you to confirm first" />
          ) : null}
        </Group>
      </ScrollView>

      <OptionSheet
        visible={picker !== null}
        title={pickerKind === 'pronouns' ? 'Pronouns' : 'Conversation style'}
        description={pickerKind === 'pronouns' ? 'How your companions refer to you.' : 'How your companions talk with you. You can change it any time.'}
        options={pickerKind === 'pronouns' ? PRONOUNS : STYLES}
        value={pickerKind === 'pronouns' ? pronounValue : styleValue}
        savingValue={savingValue}
        error={pickerError}
        onChoose={v => { void choose(v); }}
        onClose={() => setPicker(null)}
      />
      {account.sheets}
    </Screen>
  );
}

function NameField({ value, onChangeText, onCommit, state }: {
  value: string;
  onChangeText: (v: string) => void;
  onCommit: () => void;
  state: NameState;
}) {
  let status: React.ReactNode;
  if (state === 'saving') status = <Txt variant="footnote" style={styles.muted}>Saving…</Txt>;
  else if (state === 'saved') {
    status = (
      <View style={styles.statusRow}>
        <NavIcon name="check" color={W.success} size={14} />
        <Txt variant="footnote" style={{ color: W.success }}>Saved</Txt>
      </View>
    );
  } else if (state === 'error') {
    status = <Txt variant="footnote" style={{ color: W.dangerText }}>Your name wasn't saved.</Txt>;
  } else if (state === 'empty') {
    status = <Txt variant="footnote" style={{ color: W.warning }}>Your name can't be empty.</Txt>;
  } else {
    status = <Txt variant="footnote" style={styles.faint}>What your companions call you</Txt>;
  }
  return (
    <View style={styles.field}>
      <Txt variant="footnote" style={styles.muted}>Name</Txt>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        // Fires on Return and on leaving the field, so one handler covers both.
        onEndEditing={onCommit}
        returnKeyType="done"
        maxLength={50}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="name"
        textContentType="name"
        placeholder="Your name"
        placeholderTextColor={W.placeholder}
        selectionColor={W.primary}
        accessibilityLabel="Name"
        accessibilityHint="What your companions call you"
        maxFontSizeMultiplier={TYPE.body.maxScale}
        style={styles.input}
      />
      {status}
    </View>
  );
}

function FieldRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View accessible accessibilityLabel={[label, value, note].filter(Boolean).join(', ')} style={styles.field}>
      <Txt variant="footnote" style={styles.muted}>{label}</Txt>
      <Txt variant="callout" numberOfLines={2} style={{ color: W.text }}>{value}</Txt>
      {note ? <Txt variant="footnote" style={styles.faint}>{note}</Txt> : null}
    </View>
  );
}

function OptionSheet({ visible, title, description, options, value, savingValue, error, onChoose, onClose }: {
  visible: boolean;
  title: string;
  description: string;
  options: Option[];
  value: string | null;
  savingValue: string | null;
  error: string | null;
  onChoose: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <OverlaySheet visible={visible} onClose={onClose} title={title} dismissible={!savingValue}>
      <Txt variant="subhead" style={styles.sheetLead}>{description}</Txt>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.options}>
        {options.map(o => {
          const selected = value === o.value;
          const saving = savingValue === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChoose(o.value)}
              disabled={!!savingValue}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, busy: saving, disabled: !!savingValue && !saving }}
              style={({ pressed }) => [styles.option, selected ? styles.optionSelected : null, pressed ? styles.optionPressed : null]}
            >
              <Txt variant="body" weight={selected ? 600 : 400} style={styles.flexShrink}>{o.label}</Txt>
              {saving ? <ActivityIndicator color={W.text2} /> : selected ? <NavIcon name="check" color={W.primary} size={18} /> : null}
            </Pressable>
          );
        })}
      </View>
      {error ? <InlineNotice tone="error" text={error} style={styles.sheetNotice} /> : null}
    </OverlaySheet>
  );
}

// ─── S22 MEMORIES LIST ───────────────────────────────────────────────────

type MemoryFilter = 'all' | 'fact' | 'emotion' | 'event' | 'preference';
const FILTERS: { key: MemoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'fact', label: 'Facts' },
  { key: 'emotion', label: 'Emotions' },
  { key: 'event', label: 'Events' },
  { key: 'preference', label: 'Preferences' },
];

interface DisplayMemory {
  id: string;
  type: string;
  text: string;
  /** "Sep 12", or with the year when it isn't this one. */
  learned: string;
  /** How often it has been brought into a conversation. */
  recalled: number;
}

function toDisplayMemory(m: ApiMemory): DisplayMemory {
  const d = new Date(m.created_at);
  const valid = !Number.isNaN(d.getTime());
  const sameYear = valid && d.getFullYear() === new Date().getFullYear();
  return {
    id: m._id,
    type: m.type,
    text: m.content,
    learned: valid ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }) : '',
    recalled: m.access_count ?? 0,
  };
}

// Long enough to notice and reach Undo; twice that with VoiceOver running.
const UNDO_MS = 5000;
const UNDO_MS_SCREEN_READER = 10000;

export function S22_Memories({ go, characterId, companionName }: { go: Go; characterId?: string; companionName?: string }) {
  const name = companionName?.trim() || null;
  const via = name ?? 'Your companion';
  const viaMid = name ?? 'your companion';
  const screenReader = useScreenReader();
  const alive = useAlive();

  // No seeded sample data. This screen used to open on seven invented
  // memories, including a bereavement, which a new user would read as things
  // their companion believed about them. An empty list is the honest state.
  const [memories, setMemories] = useState<DisplayMemory[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>(characterId ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const request = useRef(0);

  // A forgotten memory waits out its undo window before the server is told.
  const [pending, setPending] = useState<{ memory: DisplayMemory; index: number } | null>(null);
  const pendingRef = useRef<{ memory: DisplayMemory; index: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'retry') => {
    if (!characterId) return;
    const id = ++request.current;
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'retry') setRetrying(true);
    try {
      // Everything at once and filtered here, so switching filters is instant
      // and never blanks the list.
      const data = await getMemories(characterId);
      if (!alive.current || id !== request.current) return;
      const hidden = pendingRef.current?.memory.id;
      setMemories(data.map(toDisplayMemory).filter(m => m.id !== hidden));
      setLoadError(null);
      setStatus('ready');
    } catch (e) {
      if (!alive.current || id !== request.current) return;
      // "We could not load these" and "there are none" are different facts.
      // A list already on screen stays, with a note that it couldn't refresh.
      setLoadError(e);
      setStatus(prev => (prev === 'ready' ? 'ready' : 'error'));
    } finally {
      if (alive.current && id === request.current) {
        setRefreshing(false);
        setRetrying(false);
      }
    }
  }, [characterId, alive]);

  useEffect(() => { void load('initial'); }, [load]);

  const commitPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    clearTimeout(undoTimer.current);
    if (alive.current) setPending(null);
    deleteMemory(p.memory.id).catch(e => {
      // Already gone is what was asked for.
      if (e instanceof ApiError && e.status === 404) return;
      if (!alive.current) return;
      // It is still on the server, so it goes back where it was.
      setMemories(list => (list ? insertAt(list, p.index, p.memory) : list));
      setActionError(`Couldn't forget that memory. ${failureCopy(e)}`);
      haptic.error();
    });
  }, [alive]);

  // Leaving the screen, or the app going to the background, ends the undo
  // window: the delete that was asked for must still happen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'background') commitPending(); });
    return () => {
      sub.remove();
      commitPending();
    };
  }, [commitPending]);

  const forget = (m: DisplayMemory) => {
    commitPending();
    setActionError(null);
    const index = memories?.findIndex(x => x.id === m.id) ?? -1;
    if (index < 0) return;
    setMemories(list => (list ? list.filter(x => x.id !== m.id) : list));
    const p = { memory: m, index };
    pendingRef.current = p;
    setPending(p);
    haptic.light();
    announce('Memory forgotten. You can undo this for a few seconds.');
    undoTimer.current = setTimeout(commitPending, screenReader ? UNDO_MS_SCREEN_READER : UNDO_MS);
  };

  const undo = () => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    clearTimeout(undoTimer.current);
    setPending(null);
    setMemories(list => (list ? insertAt(list, p.index, p.memory) : list));
    haptic.selection();
    announce('Memory restored');
  };

  // ── Forget everything ─────────────────────────────────────────────────
  const [clearOpen, setClearOpen] = useState(false);
  // Fixed when the sheet opens, so its text holds still while it animates out.
  const [clearCount, setClearCount] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const openClear = () => {
    setClearCount(memories?.length ?? 0);
    setClearError(null);
    setClearOpen(true);
  };

  const clearAll = async () => {
    if (!characterId || clearing) return;
    commitPending();
    setClearing(true);
    setClearError(null);
    try {
      await deleteAllMemories(characterId);
      if (!alive.current) return;
      setMemories([]);
      setFilter('all');
      setClearOpen(false);
      announce(`Everything ${viaMid} remembered has been forgotten.`);
    } catch (e) {
      if (!alive.current) return;
      setClearError(`Nothing was deleted. ${failureCopy(e)}`);
      haptic.error();
    } finally {
      if (alive.current) setClearing(false);
    }
  };

  const visible = useMemo(
    () => (memories ?? []).filter(m => filter === 'all' || m.type === filter),
    [memories, filter],
  );
  const hasAny = !!memories && memories.length > 0;
  const filterLabel = FILTERS.find(f => f.key === filter)?.label ?? 'Memories';
  const bottomPad = SP.xl + (pending ? UNDO_BAR_SPACE : 0);

  let content: React.ReactNode;
  if (!characterId) {
    content = (
      <EmptyState
        icon="sparkle"
        title="No memories yet"
        body="Memories appear here once you've talked with your companion for a while."
      />
    );
  } else if (status === 'loading' && !memories) {
    content = <MemorySkeleton />;
  } else if (status === 'error' && !memories) {
    content = (
      <ErrorState
        title="Couldn't load memories"
        body={failureCopy(loadError)}
        onRetry={() => { void load('retry'); }}
        retrying={retrying}
      />
    );
  } else {
    content = (
      <Animated.FlatList
        // A new list per filter: switching filters starts at the top and skips
        // the fade-out that a single forgotten memory gets.
        key={filter}
        style={styles.fill}
        data={visible}
        keyExtractor={m => m.id}
        renderItem={({ item }) => <MemoryRow memory={item} viaMid={viaMid} onForget={forget} />}
        itemLayoutAnimation={layout}
        skipEnteringExitingAnimations
        ItemSeparatorComponent={MemorySeparator}
        ListHeaderComponent={
          <View style={styles.memoriesHeader}>
            {hasAny ? (
              <Txt variant="subhead" style={styles.muted}>
                {`What ${viaMid} has learned from your conversations. Forget anything you'd rather they didn't keep.`}
              </Txt>
            ) : null}
            {loadError && status === 'ready' ? (
              <InlineNotice
                tone="warning"
                text={`Couldn't refresh. ${failureCopy(loadError)}`}
                actionLabel="Retry"
                onAction={() => { void load('retry'); }}
              />
            ) : null}
            {actionError ? <InlineNotice tone="error" text={actionError} /> : null}
          </View>
        }
        ListEmptyComponent={
          hasAny ? (
            <EmptyState
              icon="sparkle"
              title={`No ${filterLabel.toLowerCase()} yet`}
              body="Try another filter."
              actionLabel="Show all"
              onAction={() => setFilter('all')}
            />
          ) : (
            <EmptyState
              icon="sparkle"
              title="Nothing remembered yet"
              body={`${via} builds these from your conversations. Talk for a while and they'll appear here.`}
            />
          )
        }
        ListFooterComponent={hasAny && visible.length > 0 ? (
          <TextButton
            label={`Forget everything ${viaMid} knows`}
            danger
            onPress={openClear}
            accessibilityHint="Asks you to confirm first"
            style={styles.forgetAll}
          />
        ) : null}
        contentContainerStyle={[styles.memoriesContent, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { void load('refresh'); }} tintColor={W.text2} colors={[W.primary]} progressBackgroundColor={W.surface2} />
        }
      />
    );
  }

  return (
    <Screen>
      <TopBar left={<BackButton onPress={() => go('settings')} />} title="Memories" glass border focusTitleOnMount />
      {hasAny ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Show" style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map(f => (
              <Pill key={f.key} size="sm" selected={filter === f.key} onPress={() => setFilter(f.key)}>
                {f.label}
              </Pill>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {content}
      {pending ? <UndoBar bottom={SP.base} onUndo={undo} /> : null}
      <ConfirmSheet
        visible={clearOpen}
        tone="danger"
        title={`Forget everything ${viaMid} knows?`}
        body={`This erases ${clearCount === 1 ? 'the one memory' : `all ${clearCount} memories`} ${viaMid} has built from your conversations. Your messages stay; what they learned from them doesn't. This can't be undone.`}
        confirmLabel="Forget everything"
        busy={clearing}
        error={clearError}
        onConfirm={() => { void clearAll(); }}
        onCancel={() => setClearOpen(false)}
      />
    </Screen>
  );
}

const MemorySeparator = () => <View style={styles.memoryGap} />;

function MemoryRow({ memory, viaMid, onForget }: { memory: DisplayMemory; viaMid: string; onForget: (m: DisplayMemory) => void }) {
  const kind = MEM_TYPES[memory.type] ?? { l: 'Memory', color: W.text2 };
  const [exiting] = useState(() => exit.fade);
  const recalled = memory.recalled > 0
    ? `brought up ${memory.recalled} ${memory.recalled === 1 ? 'time' : 'times'}`
    : '';
  const meta = [memory.learned ? `Learned ${memory.learned}` : '', recalled].filter(Boolean).join(' · ');
  return (
    <Animated.View exiting={exiting} style={styles.memory}>
      <View accessible accessibilityLabel={`${kind.l}. ${memory.text}${meta ? `. ${meta}` : ''}`} style={styles.memoryBody}>
        <View style={[styles.memoryKind, { backgroundColor: rgba(kind.color, 0.14), borderColor: rgba(kind.color, 0.3) }]}>
          <Txt variant="caption" weight={600} maxScale={1.3} style={{ color: kind.color }}>{kind.l}</Txt>
        </View>
        <Txt variant="callout" style={styles.memoryText}>{memory.text}</Txt>
        {/* Retrieval is otherwise invisible: this is the difference between
            claiming to remember and showing the receipts. */}
        {meta ? <Txt variant="footnote" style={styles.muted}>{meta}</Txt> : null}
      </View>
      <IconButton
        icon="trash"
        label={`Forget: ${truncate(memory.text, 80)}`}
        onPress={() => onForget(memory)}
        size={HIT}
        iconSize={20}
        tint={W.text2}
        haptic={false}
        accessibilityHint={`${capitalize(viaMid)} won't bring this up again. You can undo for a few seconds.`}
      />
    </Animated.View>
  );
}

function MemorySkeleton() {
  return (
    <View accessible accessibilityLabel="Loading memories" accessibilityState={{ busy: true }} style={styles.memoriesContent}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={[styles.memory, i > 0 ? styles.memorySkeletonGap : null]}>
          <View style={styles.memoryBody}>
            <Skeleton width={56} height={18} radius={R.sm} />
            <Skeleton height={12} style={styles.skeletonLine} />
            <Skeleton width="70%" height={12} style={styles.skeletonLineTight} />
          </View>
        </View>
      ))}
    </View>
  );
}

// Room kept at the end of the list so the last memory can scroll clear of the undo bar.
const UNDO_BAR_SPACE = 64;

function UndoBar({ bottom, onUndo }: { bottom: number; onUndo: () => void }) {
  const [entering] = useState(() => enter.fadeUp);
  const [exiting] = useState(() => exit.fadeDown);
  return (
    <Animated.View entering={entering} exiting={exiting} accessibilityLiveRegion="polite" style={[styles.undoBar, { bottom }]}>
      <GlassFill intensity={40} solid={W.surface2} />
      <Txt variant="subhead" style={styles.flexShrink}>Memory forgotten</Txt>
      <Pressable
        onPress={onUndo}
        hitSlop={minTarget(64, 32)}
        accessibilityRole="button"
        accessibilityLabel="Undo, bring the memory back"
        style={({ pressed }) => [styles.undoAction, pressed ? styles.pressedDim : null]}
      >
        <NavIcon name="undo" color={W.primarySoft} size={16} />
        <Txt variant="subhead" weight={600} style={{ color: W.primarySoft }}>Undo</Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── S23 PAYWALL ─────────────────────────────────────────────────────────

// What the upgrade is for, by what opened the sheet. Anything else gets the
// neutral headline: "Add more companions" was dropped because no plan raises
// the companion limit.
const PAYWALL_HEADLINES: Partial<Record<PaywallTrigger, string>> = {
  voice: 'More time to talk',
  cap: 'Keep the conversation going',
  studio: 'Keep practicing in Studio',
};

const TIER_RANK: Record<PaidTier, number> = { plus: 1, premium: 2 };
const TIER_ACCENT: Record<PaidTier, string> = { plus: W.primary, premium: W.gold };

// After a purchase the server is told to re-read the store. That can fail
// (offline, a 502 from the store, rate limiting), so it is retried, and a
// charged user is never told their purchase failed.
const SYNC_RETRY_MS = [2000, 5000, 10000, 20000];

type PaywallPhase = 'browse' | 'buying' | 'confirming' | 'delayed' | 'pending' | 'done';

interface PriceView {
  /** "$4.99/mo", or null while unknown or when the store has no price. */
  main: string | null;
  /** "$47.99 billed yearly", or why there is no price. */
  note: string | null;
  loading: boolean;
  spoken: string | null;
}

export interface PaywallProps {
  go: Go;
  trigger?: PaywallTrigger;
  backTo?: ScreenName;
  entitlement?: ApiEntitlement | null;
  /** Called with the refreshed entitlement once a purchase or restore lands, after the sheet has closed. */
  onPurchased?: (e: ApiEntitlement) => void;
  /** The entitlement request failed; without it a null entitlement reads as still loading. */
  entitlementFailed?: boolean;
  /** Re-reads the entitlement. Return its promise to show the retry as busy. */
  onRetryEntitlement?: () => void | Promise<unknown>;
  /** Called once the sheet has animated out. Defaults to go(backTo). */
  onClose?: () => void;
}

export function S23_Paywall({
  go, trigger, backTo = 'home', entitlement, onPurchased, entitlementFailed = false, onRetryEntitlement, onClose,
}: PaywallProps) {
  const { width, fontScale } = useWindowDimensions();
  const alive = useAlive();
  const [open, setOpen] = useState(true);
  const result = useRef<ApiEntitlement | null>(null);

  const plans = entitlement?.plans ?? [];
  const current = currentPaidTier(entitlement);
  // Start from the plan they already have; nothing is chosen for anyone else.
  const [picked, setPicked] = useState<PaidTier | null>(current);
  useEffect(() => { if (current) setPicked(p => p ?? current); }, [current]);
  const [annual, setAnnual] = useState(false);

  const storeReady = storeAvailable();
  const store = storeName();
  const billedBy: StorePlatform | null =
    entitlement?.platform === 'ios' || entitlement?.platform === 'android' ? entitlement.platform : null;
  const [storePlans, setStorePlans] = useState<StorePlan[] | null>(null);
  const [storeError, setStoreError] = useState<unknown>(null);

  const loadStore = useCallback(() => {
    if (!storeReady) return;
    setStoreError(null);
    setStorePlans(null);
    loadStorePlans()
      .then(p => { if (alive.current) setStorePlans(p); })
      .catch(e => {
        if (!alive.current) return;
        setStoreError(e);
        setStorePlans([]);
      });
  }, [storeReady, alive]);
  useEffect(() => { loadStore(); }, [loadStore]);

  const storePlanFor = useCallback(
    (tier: PaidTier, yearly: boolean) => storePlans?.find(p => p.tier === tier && p.annual === yearly) ?? null,
    [storePlans],
  );
  const sellsMonthly = !!storePlans?.some(p => !p.annual);
  const sellsYearly = !!storePlans?.some(p => p.annual);
  // Only one period on sale: show that one.
  useEffect(() => {
    if (sellsYearly && !sellsMonthly) setAnnual(true);
    else if (sellsMonthly && !sellsYearly) setAnnual(false);
  }, [sellsMonthly, sellsYearly]);

  const [phase, setPhase] = useState<PaywallPhase>('browse');
  const [confirmKind, setConfirmKind] = useState<'purchase' | 'restore'>('purchase');
  const [done, setDone] = useState<{ entitlement: ApiEntitlement; restored: boolean } | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const storePlan = picked ? storePlanFor(picked, annual) : null;

  // ── Closing ────────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    // The store's own sheet is up while buying; its answer needs somewhere to land.
    if (phase === 'buying') return;
    setOpen(false);
  }, [phase]);

  // The router hosts this sheet over the screen that opened it, and only
  // removes it when told, so tell it once the sheet has animated out.
  useAfterExit(open, () => {
    if (result.current) onPurchased?.(result.current);
    if (onClose) onClose();
    else go(backTo);
  });

  // ── Buying ─────────────────────────────────────────────────────────────
  const finish = (e: ApiEntitlement, restored: boolean) => {
    result.current = e;
    setDone({ entitlement: e, restored });
    setPhase('done');
    haptic.success();
    announce(restored ? `Welcome back. You're on ${e.tier_label}.` : `You're on ${e.tier_label}.`);
  };

  /** Re-reads the store on the server until it shows the plan, or gives up quietly. */
  const confirmPlan = async (): Promise<ApiEntitlement | null> => {
    for (let attempt = 0; ; attempt++) {
      let delay: number | undefined = SYNC_RETRY_MS[attempt];
      try {
        const e = await syncEntitlement();
        if (e.tier !== 'free') return e;
      } catch (err) {
        if (err instanceof AuthExpiredError) return null;
        if (delay !== undefined && err instanceof ApiError && err.retryAfter) delay = Math.max(delay, err.retryAfter * 1000);
      }
      if (delay === undefined || !alive.current) return null;
      await wait(delay);
      if (!alive.current) return null;
    }
  };

  const purchaseFailure = (e: unknown): string => {
    switch (storeFailureOf(e)) {
      case 'offline': return `Couldn't reach ${store}. Check your connection and try again.`;
      case 'not-allowed': return "This device isn't allowed to make purchases.";
      case 'already-owned': return 'You already have this plan. Use Restore purchases below to bring it back.';
      default: return `The purchase didn't go through. Check ${store} and try again.`;
    }
  };

  const subscribe = async () => {
    if (!storePlan || phase !== 'browse') return;
    setMessage(null);
    setPhase('buying');
    let outcome: PurchaseOutcome;
    try {
      outcome = await buyPlan(storePlan);
    } catch (e) {
      if (!alive.current) return;
      setPhase('browse');
      setMessage({ tone: 'error', text: purchaseFailure(e) });
      haptic.error();
      return;
    }
    if (!alive.current) return;
    if (outcome === 'cancelled') {
      setPhase('browse');
      return;
    }
    if (outcome === 'pending') {
      setPhase('pending');
      announce(`Payment pending. Your plan unlocks when ${store} confirms it.`);
      return;
    }
    // The store has taken the payment. Nothing from here on may say it failed.
    setConfirmKind('purchase');
    setPhase('confirming');
    announce('Payment received. Setting up your plan.');
    const e = await confirmPlan();
    if (!alive.current) return;
    if (e) finish(e, false);
    else setPhase('delayed');
  };

  const restore = async () => {
    if (!storeReady || restoring || phase !== 'browse') return;
    setMessage(null);
    setRestoring(true);
    let found: boolean;
    try {
      found = await restorePurchases();
    } catch (e) {
      if (!alive.current) return;
      setRestoring(false);
      setMessage({
        tone: 'error',
        text: storeFailureOf(e) === 'offline'
          ? `Couldn't reach ${store}. Check your connection and try again.`
          : `Couldn't check ${store} just now. Try again in a moment.`,
      });
      return;
    }
    if (!alive.current) return;
    setRestoring(false);
    if (!found) {
      setMessage({ tone: 'info', text: `No active subscription was found for this ${DEVICE_STORE === 'ios' ? 'Apple ID' : 'Google account'}.` });
      return;
    }
    // The store has one. Only our server has to catch up now.
    setConfirmKind('restore');
    setPhase('confirming');
    const e = await confirmPlan();
    if (!alive.current) return;
    if (e) finish(e, true);
    else setPhase('delayed');
  };

  const manage = async () => {
    setMessage(null);
    const ok = await openManageSubscriptions();
    if (!ok && alive.current) setMessage({ tone: 'error', text: `Couldn't open ${store}. You can manage your plan there directly.` });
  };

  const retryPlans = async () => {
    if (!onRetryEntitlement || retrying) return;
    setRetrying(true);
    await Promise.resolve(onRetryEntitlement()).catch(() => {});
    if (alive.current) setRetrying(false);
  };

  // ── Prices, straight from the store ───────────────────────────────────
  // Store prices only: the catalog's dollar figures next to the store's own
  // currency read as two different prices.
  const priceOf = (tier: PaidTier): PriceView => {
    if (!storeReady || storeError) return { main: null, note: null, loading: false, spoken: null };
    if (storePlans === null) return { main: null, note: null, loading: true, spoken: null };
    const sp = storePlanFor(tier, annual);
    if (!sp) return { main: null, note: 'Not on sale right now', loading: false, spoken: 'not on sale right now' };
    if (!annual) return { main: `${sp.priceString}/mo`, note: null, loading: false, spoken: `${sp.priceString} a month` };
    return sp.pricePerMonthString
      ? { main: `${sp.pricePerMonthString}/mo`, note: `${sp.priceString} billed yearly`, loading: false, spoken: `${sp.pricePerMonthString} a month, ${sp.priceString} billed yearly` }
      : { main: `${sp.priceString}/yr`, note: null, loading: false, spoken: `${sp.priceString} a year` };
  };

  const savingFor = (tier: PaidTier) => {
    const m = storePlanFor(tier, false);
    const y = storePlanFor(tier, true);
    return m && y ? savingsPercent(m.price, y.price) : null;
  };
  let saving: string | null = null;
  if (picked) {
    const s = savingFor(picked);
    saving = s ? `Save ${s}%` : null;
  } else {
    const all = (['plus', 'premium'] as const).map(savingFor).filter((s): s is number => s !== null);
    if (all.length) saving = Math.min(...all) === Math.max(...all) ? `Save ${all[0]}%` : `Save up to ${Math.max(...all)}%`;
  }

  // ── The action ─────────────────────────────────────────────────────────
  const labelOf = (tier: PaidTier | null) => plans.find(p => p.tier === tier)?.label ?? 'this plan';
  let cta: { label: string; onPress: () => void; disabled?: boolean; buys: boolean } | null = null;
  let ctaNote: string | null = null;
  if (storeReady && plans.length > 0) {
    const otherStore = !!billedBy && billedBy !== DEVICE_STORE;
    if (!picked) {
      cta = { label: 'Choose a plan', onPress: () => {}, disabled: true, buys: false };
    } else if (current && entitlement?.platform === 'dev_grant' && TIER_RANK[picked] <= TIER_RANK[current]) {
      // Granted, not bought: there is no store subscription to manage.
      ctaNote = 'Your plan was set up by the Evarna team.';
    } else if (current && otherStore) {
      // Buying here would start a second subscription beside the one they pay for.
      ctaNote = `Your plan is billed through ${storeName(billedBy)}. Change it on the device you bought it on.`;
    } else if (current && TIER_RANK[picked] <= TIER_RANK[current]) {
      // Keeping, downgrading or cancelling happens in the store that bills it.
      cta = { label: picked === current ? `Manage in ${store}` : `Change plan in ${store}`, onPress: () => { void manage(); }, buys: false };
    } else {
      cta = {
        label: current ? `Upgrade to ${labelOf(picked)}` : storePlan?.hasFreeTrial ? 'Start free trial' : `Subscribe to ${labelOf(picked)}`,
        onPress: () => { void subscribe(); },
        disabled: !storePlan,
        buys: true,
      };
      if (storePlans === null) ctaNote = `Contacting ${store}…`;
      else if (!storePlan && !storeError) ctaNote = "This plan isn't on sale right now.";
    }
  }
  const terms = cta?.buys && storePlan
    ? `${storePlan.hasFreeTrial ? 'Free trial, then ' : ''}${storePlan.priceString} a ${storePlan.annual ? 'year' : 'month'}. Renews automatically until you cancel in ${store}.`
    : null;

  // ── Words ──────────────────────────────────────────────────────────────
  const headline = current ? 'Your plan' : (trigger && PAYWALL_HEADLINES[trigger]) || 'Choose your plan';
  const anyTrial = !!storePlans?.some(p => p.hasFreeTrial);
  const lead = current && entitlement
    ? `You're on ${entitlement.tier_label}.`
    : !storeReady ? null
    : anyTrial ? 'Start with a free trial. Cancel anytime.'
    : `Cancel anytime in ${store}.`;
  let unavailableNote: string | null = null;
  if (!storeReady) {
    if (current && billedBy && billedBy !== DEVICE_STORE) unavailableNote = `Your plan is billed through ${storeName(billedBy)}. Manage it there.`;
    else if (current) unavailableNote = null;
    else unavailableNote = DEVICE_STORE === 'ios' ? 'Plus and Premium are coming to iPhone soon.' : "Purchases aren't available in this version of the app.";
  }

  const stacked = width < 360 || fontScale > 1.2;
  const browsing = phase === 'browse' || phase === 'buying';

  // ── Body ───────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (phase === 'done' && done) {
    body = <PurchaseDone entitlement={done.entitlement} restored={done.restored} />;
  } else if (!browsing) {
    body = <PurchaseStatus phase={phase} kind={confirmKind} store={store} />;
  } else {
    let plansView: React.ReactNode;
    if (!entitlement) {
      plansView = entitlementFailed ? (
        <ErrorState
          title="Couldn't load plans"
          body="Check your connection and try again."
          onRetry={onRetryEntitlement ? () => { void retryPlans(); } : undefined}
          retrying={retrying}
        />
      ) : (
        <PlanSkeleton stacked={stacked} />
      );
    } else if (plans.length === 0) {
      plansView = <EmptyState icon="sparkle" title="No plans on sale right now" body="Please check back soon." />;
    } else {
      plansView = (
        <>
          {storeReady && sellsMonthly && sellsYearly ? (
            <PeriodSwitch annual={annual} onChange={setAnnual} saving={saving} />
          ) : null}
          <View
            accessibilityRole={storeReady ? 'radiogroup' : undefined}
            accessibilityLabel={storeReady ? 'Plans' : undefined}
            style={[styles.plans, stacked ? styles.plansStacked : null]}
          >
            {plans.map(p => (
              <PlanCard
                key={p.tier}
                plan={p}
                accent={TIER_ACCENT[p.tier]}
                price={priceOf(p.tier)}
                current={current === p.tier}
                picked={storeReady && picked === p.tier}
                stacked={stacked}
                // Nothing to choose between where nothing can be bought.
                onPick={storeReady ? () => {
                  setPicked(p.tier);
                  setMessage(null);
                } : undefined}
              />
            ))}
          </View>
          {storeError ? (
            <InlineNotice tone="error" text={`Couldn't reach ${store} for prices.`} actionLabel="Try again" onAction={loadStore} style={styles.payNotice} />
          ) : null}
          {unavailableNote ? <InlineNotice tone="info" text={unavailableNote} style={styles.payNotice} /> : null}
        </>
      );
    }
    body = (
      <>
        <View style={styles.payHead}>
          {/* Spoken once, by the sheet's own header. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.flexShrink}>
            <Txt variant="title2" style={{ color: W.text }}>{headline}</Txt>
          </View>
          <IconButton icon="close" label="Close" onPress={requestClose} size={36} iconSize={18} variant="glass" haptic={false} disabled={phase === 'buying'} />
        </View>
        {lead ? <Txt variant="subhead" style={styles.payLead}>{lead}</Txt> : null}
        {plansView}
      </>
    );
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  let footer: React.ReactNode = null;
  if (phase === 'done' || phase === 'delayed' || phase === 'pending') {
    footer = <PrimaryButton onPress={requestClose} haptic={false}>Done</PrimaryButton>;
  } else if (browsing) {
    footer = (
      <>
        {message ? <InlineNotice tone={message.tone} text={message.text} /> : null}
        {cta ? (
          <PrimaryButton
            onPress={cta.onPress}
            disabled={cta.disabled}
            loading={phase === 'buying'}
            haptic={cta.buys ? 'medium' : 'light'}
            accessibilityHint={cta.buys ? `Opens ${store} to confirm` : undefined}
          >
            {cta.label}
          </PrimaryButton>
        ) : null}
        {ctaNote ? <Txt variant="footnote" style={styles.centerMuted}>{ctaNote}</Txt> : null}
        {terms ? <Txt variant="caption" style={styles.terms}>{terms}</Txt> : null}
        <View style={styles.footerLinks}>
          {storeReady ? (
            <TextButton label={restoring ? 'Checking…' : 'Restore purchases'} onPress={() => { void restore(); }} disabled={restoring || phase !== 'browse'} />
          ) : null}
          {LEGAL_DOCS.map(doc => <LegalLink key={doc.id} doc={doc} />)}
        </View>
      </>
    );
  }

  return (
    <Sheet
      visible={open}
      onClose={requestClose}
      accessibilityLabel={phase === 'done' ? 'Purchase complete' : headline}
      dismissible={phase !== 'buying'}
      maxHeightPct={0.92}
      footer={footer}
    >
      {body}
    </Sheet>
  );
}

function LegalLink({ doc }: { doc: LegalDoc }) {
  return (
    <Pressable
      onPress={() => { void openLegalDoc(doc); }}
      accessibilityRole="link"
      accessibilityHint="Opens in your browser"
      style={({ pressed }) => [styles.textButton, pressed ? styles.pressedDim : null]}
    >
      <Txt variant="footnote" style={styles.legalLink}>{doc.title}</Txt>
    </Pressable>
  );
}

const SEGMENT_SLOP = { top: SP.xs, bottom: SP.xs };

function PeriodSwitch({ annual, onChange, saving }: { annual: boolean; onChange: (v: boolean) => void; saving: string | null }) {
  const options = [{ yearly: false, label: 'Monthly' }, { yearly: true, label: 'Yearly' }];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Billing period" style={styles.segment}>
      {options.map(o => {
        const on = annual === o.yearly;
        return (
          <Pressable
            key={o.label}
            onPress={() => {
              if (on) return;
              haptic.selection();
              onChange(o.yearly);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.yearly && saving ? `${o.label}, ${saving.toLowerCase()}` : o.label}
            // The track's padding makes up the rest of the 44pt target.
            hitSlop={SEGMENT_SLOP}
            style={[styles.segmentItem, on ? styles.segmentItemOn : null]}
          >
            <Txt variant="subhead" weight={on ? 600 : 500} style={{ color: on ? W.text : W.text2 }}>{o.label}</Txt>
            {o.yearly && saving ? (
              <View style={styles.saveChip}>
                <Txt variant="caption" weight={600} maxScale={1.2} style={{ color: W.gold }}>{saving}</Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function PlanCard({ plan, accent, price, current, picked, stacked, onPick }: {
  plan: ApiBillingPlan;
  accent: string;
  price: PriceView;
  current: boolean;
  picked: boolean;
  stacked: boolean;
  /** Absent where plans can't be bought: the card is then only a description. */
  onPick?: () => void;
}) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle, haptic: false });
  // Generated from the server's catalog, not typed here. Hand-written copy is
  // how this card came to advertise "500 voice min/mo" for a tier that allows 400.
  const features = planFeatures(plan);
  const spoken = [plan.label, current ? 'your current plan' : null, price.spoken, ...features].filter(Boolean).join(', ');
  const surface = [
    styles.plan,
    stacked ? null : styles.grow,
    { borderColor: picked ? accent : W.hairline, backgroundColor: picked ? rgba(accent, 0.1) : W.glass },
  ];
  const content = (
    <>
      <View style={styles.planHead}>
        <Txt variant="headline" numberOfLines={1} style={[styles.flexShrink, { color: accent }]}>{plan.label}</Txt>
        {onPick ? (
          <View style={[styles.radio, picked ? { backgroundColor: accent, borderColor: accent } : null]}>
            {picked ? <NavIcon name="check" color={W.onAccent} size={12} /> : null}
          </View>
        ) : null}
      </View>
      {current ? (
        <View style={[styles.currentBadge, { backgroundColor: rgba(accent, 0.16) }]}>
          <Txt variant="caption" weight={600} maxScale={1.2} style={{ color: accent }}>Current plan</Txt>
        </View>
      ) : null}
      {price.loading ? (
        <Skeleton width={84} height={22} style={styles.planPrice} />
      ) : price.main ? (
        <View style={styles.planPrice}>
          <Txt variant="title3" style={{ color: W.text }}>{price.main}</Txt>
          {price.note ? <Txt variant="caption" style={styles.muted}>{price.note}</Txt> : null}
        </View>
      ) : price.note ? (
        <Txt variant="caption" style={[styles.muted, styles.planPrice]}>{price.note}</Txt>
      ) : null}
      <View style={styles.features}>
        {features.map(f => (
          <View key={f} style={styles.feature}>
            <View style={styles.featureTick}><NavIcon name="check" color={accent} size={14} /></View>
            <Txt variant="footnote" style={styles.featureText}>{f}</Txt>
          </View>
        ))}
      </View>
    </>
  );

  if (!onPick) {
    return (
      <View accessible accessibilityLabel={spoken} style={[stacked ? null : styles.flex1, ...surface]}>
        {content}
      </View>
    );
  }
  return (
    <Animated.View style={[stacked ? null : styles.flex1, press.animatedStyle]}>
      <Pressable
        onPress={() => {
          if (!picked) haptic.selection();
          onPick();
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="radio"
        accessibilityState={{ selected: picked }}
        accessibilityLabel={spoken}
        style={surface}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

function PlanSkeleton({ stacked }: { stacked: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel="Loading plans"
      accessibilityState={{ busy: true }}
      style={[styles.plans, stacked ? styles.plansStacked : null]}
    >
      {[0, 1].map(i => (
        <View key={i} style={[styles.plan, stacked ? null : styles.flex1]}>
          <Skeleton width={72} height={18} />
          <Skeleton width={96} height={22} style={styles.planPrice} />
          <SkeletonLines lines={3} style={styles.features} />
        </View>
      ))}
    </View>
  );
}

function PurchaseDone({ entitlement, restored }: { entitlement: ApiEntitlement; restored: boolean }) {
  const plan = entitlement.plans.find(p => p.tier === entitlement.tier);
  const [entering] = useState(() => enter.scaleIn);
  return (
    <Animated.View entering={entering} style={styles.statusWrap}>
      <View style={styles.doneMark}>
        <LinearGradient colors={GRAD.aurora} {...DIAGONAL} style={[FILL, styles.doneMarkFill]} />
        <NavIcon name="check" color={W.onAccent} size={30} />
        <Sparkles count={6} />
      </View>
      <Txt variant="title2" heading style={styles.center}>
        {restored ? `Welcome back to ${entitlement.tier_label}` : `You're on ${entitlement.tier_label}`}
      </Txt>
      {plan ? (
        <Txt variant="body" style={styles.centerMuted}>
          {`${plan.voice_minutes} voice minutes a month and ${plan.daily_messages.toLocaleString('en-US')} messages a day are ready for you.`}
        </Txt>
      ) : null}
    </Animated.View>
  );
}

function PurchaseStatus({ phase, kind, store }: { phase: PaywallPhase; kind: 'purchase' | 'restore'; store: string }) {
  let title: string;
  let text: string;
  if (phase === 'confirming') {
    title = kind === 'restore' ? 'Restoring your plan' : 'Payment received';
    text = 'Setting up your plan…';
  } else if (phase === 'pending') {
    title = 'Payment pending';
    text = `${capitalize(store)} is still confirming your payment. Your plan unlocks as soon as it goes through.`;
  } else {
    title = kind === 'restore' ? 'We found your subscription' : 'Payment received';
    text = "Your plan can take a few minutes to show up here. You don't need to buy it again.";
  }
  return (
    <View style={styles.statusWrap} accessibilityLiveRegion="polite">
      {phase === 'confirming' ? (
        <ActivityIndicator size="large" color={W.text2} />
      ) : (
        <View style={styles.statusMark}>
          <NavIcon name={phase === 'pending' ? 'clock' : 'check'} color={W.gold} size={26} />
        </View>
      )}
      <Txt variant="title2" heading style={styles.center}>{title}</Txt>
      <Txt variant="body" style={styles.centerMuted}>{text}</Txt>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex1: { flex: 1 },
  grow: { flexGrow: 1 },
  flexShrink: { flexShrink: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  muted: { color: W.text2 },
  faint: { color: W.text3 },
  centerMuted: { color: W.text2, textAlign: 'center' },
  dim: { opacity: 0.45 },
  pressedDim: { opacity: 0.6 },

  // Sheets
  sheetBody: { color: W.text2 },
  sheetLead: { color: W.text2, marginBottom: SP.base },
  sheetNotice: { marginTop: SP.base },

  // Groups and rows
  group: { gap: SP.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: W.hairlineStrong, marginLeft: SP.md2 },
  row: {
    minHeight: 52, paddingVertical: SP.md, paddingHorizontal: SP.md2,
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
  },
  rowPressed: { backgroundColor: rgba(W.text, 0.06) },
  rowIcon: { width: 30, height: 30, borderRadius: R.sm2, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowSub: { color: W.text2, marginTop: SP.xxs },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: SP.xs2, flexShrink: 1, maxWidth: '55%' },
  rowValue: { color: W.text2, flexShrink: 1, textAlign: 'right' },
  textButton: {
    minHeight: HIT, paddingHorizontal: SP.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  tierChip: { paddingVertical: SP.xxs, paddingHorizontal: SP.sm2, borderRadius: R.sm, flexShrink: 1 },
  monogramWell: { flex: 1, backgroundColor: W.surface1, alignItems: 'center', justifyContent: 'center' },
  companionMark: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

  // S21
  settingsContent: { paddingTop: SP.sm, paddingHorizontal: SP.base, gap: SP.xl },
  largeTitle: { color: W.cream, paddingHorizontal: SP.xs, paddingTop: SP.base },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md2 },
  profileNameRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' },
  profileName: { color: W.cream, flexShrink: 1 },

  hero: {
    borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: rgba(W.primary, 0.2),
    backgroundColor: W.glassRaised,
  },
  heroGlowGold: { position: 'absolute', top: -80, right: -70 },
  heroGlowViolet: { position: 'absolute', bottom: -80, left: -70 },
  heroEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: W.hairlineStrong },
  heroBody: { padding: SP.base2, gap: SP.base },
  heroDivider: { height: StyleSheet.hairlineWidth, backgroundColor: W.hairlineStrong },
  heroStats: { flexDirection: 'row', gap: SP.md2 },
  heroStatsStacked: { flexDirection: 'column', gap: SP.base },
  heroStat: { flex: 1, gap: SP.xs2, minWidth: 0 },
  heroStatInner: { gap: SP.xs2 },
  heroNotice: { marginTop: SP.sm },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: SP.base },
  baselineRow: { flexDirection: 'row', alignItems: 'baseline', gap: SP.xs, flexWrap: 'wrap' },
  bestLabel: { color: W.text3, marginLeft: SP.xs },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs2 },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  statNumber: { color: W.cream, fontSize: 24, lineHeight: 28 },
  seePlans: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  skeletonStack: { flex: 1, gap: SP.sm },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringSvg: { position: 'absolute' },
  ringWell: {
    width: RING - 16, height: RING - 16, borderRadius: RING, backgroundColor: W.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  sparkline: { height: 24, marginTop: SP.xxs },

  // S_UserProfile
  profileContent: { paddingHorizontal: SP.base, paddingTop: SP.sm, paddingBottom: SP.xxl, gap: SP.xl },
  profileHero: { alignItems: 'center', gap: SP.md, paddingTop: SP.sm },
  field: { paddingVertical: SP.md, paddingHorizontal: SP.md2, gap: SP.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  input: {
    minHeight: HIT, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: R.md,
    backgroundColor: W.surface3, borderWidth: 1, borderColor: W.hairline,
    color: W.text, fontFamily: resolveFont('user', 500), fontSize: TYPE.body.size,
  },
  options: { gap: SP.sm },
  option: {
    minHeight: 52, paddingHorizontal: SP.base, paddingVertical: SP.sm, borderRadius: R.md2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md,
    backgroundColor: W.glass, borderWidth: 1, borderColor: W.hairline,
  },
  optionSelected: { backgroundColor: rgba(W.primary, 0.1), borderColor: rgba(W.primary, 0.5) },
  optionPressed: { backgroundColor: rgba(W.text, 0.06) },

  // S22
  filterBar: { flexGrow: 0 },
  filters: { paddingVertical: SP.sm, paddingHorizontal: SP.base, gap: SP.sm },
  memoriesContent: { paddingHorizontal: SP.base, paddingTop: SP.sm, flexGrow: 1 },
  memoriesHeader: { gap: SP.md, paddingBottom: SP.md },
  memory: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs,
    paddingVertical: SP.md, paddingLeft: SP.md2, paddingRight: SP.xs,
    borderRadius: R.lg, backgroundColor: W.glass, borderWidth: 1, borderColor: W.hairline,
  },
  memoryGap: { height: SP.sm },
  memorySkeletonGap: { marginTop: SP.sm },
  memoryBody: { flex: 1, minWidth: 0, gap: SP.xs2 },
  memoryKind: {
    alignSelf: 'flex-start', paddingVertical: SP.xxs, paddingHorizontal: SP.sm, borderRadius: R.sm, borderWidth: 1,
  },
  memoryText: { color: W.text },
  skeletonLine: { marginTop: SP.xs },
  skeletonLineTight: { marginTop: SP.xxs },
  forgetAll: { marginTop: SP.lg },
  undoBar: {
    position: 'absolute', left: SP.base, right: SP.base, minHeight: 52,
    paddingLeft: SP.base, paddingRight: SP.xs, borderRadius: R.lg, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md,
    backgroundColor: W.glassBar, borderWidth: 1, borderColor: W.hairlineStrong,
  },
  undoAction: {
    minHeight: 36, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.xs2,
  },

  // S23
  payHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP.md },
  payLead: { color: W.text2, marginTop: SP.xs2 },
  payNotice: { marginTop: SP.base },
  segment: {
    marginTop: SP.lg, flexDirection: 'row', padding: SP.xs, borderRadius: R.lg,
    backgroundColor: rgba(W.text, 0.06), borderWidth: 1, borderColor: W.hairline,
  },
  segmentItem: {
    flex: 1, minHeight: HIT - SP.sm, borderRadius: R.md, paddingHorizontal: SP.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs2, flexWrap: 'wrap',
  },
  segmentItemOn: { backgroundColor: W.surface3 },
  saveChip: { paddingHorizontal: SP.xs2, paddingVertical: 1, borderRadius: R.xs, backgroundColor: rgba(W.gold, 0.14) },
  plans: { marginTop: SP.base, flexDirection: 'row', gap: SP.sm2 },
  plansStacked: { flexDirection: 'column' },
  plan: { borderRadius: R.lg2, borderWidth: 1.5, padding: SP.md2, gap: SP.xs, borderColor: W.hairline, backgroundColor: W.glass },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: W.text3,
    alignItems: 'center', justifyContent: 'center',
  },
  currentBadge: { alignSelf: 'flex-start', paddingHorizontal: SP.sm, paddingVertical: SP.xxs, borderRadius: R.sm },
  planPrice: { marginTop: SP.sm },
  features: { marginTop: SP.md, gap: SP.xs2 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs2 },
  featureTick: { marginTop: 1 },
  featureText: { flex: 1, color: W.text },
  terms: { color: W.text3, textAlign: 'center' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: SP.xs },
  legalLink: { color: W.text2, textDecorationLine: 'underline' },
  statusWrap: { alignItems: 'center', gap: SP.md, paddingTop: SP.xl, paddingBottom: SP.base },
  statusMark: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.gold, 0.12), borderWidth: 1, borderColor: rgba(W.gold, 0.3),
  },
  doneMark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  doneMarkFill: { borderRadius: 32 },
});
