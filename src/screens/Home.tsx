// Home.tsx — S10 Home: a greeting, the check-in card, the companion list and
// the week strip. "Ember Dusk": the header carries the streak, the check-in
// sits above the companions, and the week closes the screen.
//
// Everything shown is real: the line under the greeting, the memory and
// last-talked stamps, the streak and the week all come from the backend, and
// anything the backend hasn't answered is either a skeleton or absent.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions,
  type AccessibilityActionEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, TopBar } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon } from '../components/NavIcon';
import {
  Card, EmptyState, ErrorState, IconButton, InlineNotice, Pill, PrimaryButton, Skeleton, StreakPill, minTarget,
} from '../components/Atoms';
import { Avatar } from '../components/Avatar';
import { RadialGlow } from '../components/RadialGlow';
import { useTabBarHeight } from '../components/BottomNav';
import { enter, exit, layout, useAppActive, usePressFeedback } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { ELEV, GRAD, HIT, MOTION, R, SP, W, rgba } from '../theme/theme';
import { Go } from '../navigation/types';
import { useTabReselect } from '../navigation/tabEvents';
import { Companion, ARCHETYPE_COLORS, ARCHETYPE_LABEL, CHECK_IN } from '../data/config';
import { getActivity, ApiActivity } from '../api';
import { getAuthToken } from '../api/client';

/** One left edge for text and cards, matching the TopBar's padding. */
const GUTTER = SP.lg;

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v && typeof (v as PromiseLike<unknown>).then === 'function';

// ─── Time ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Exported so Studio's Continue row can stamp last_interaction_at the same way.
export function formatLastInteraction(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  // Calendar days, not elapsed 24h blocks: 23:00 Monday seen at 00:30
  // Wednesday is two days ago, although only 25 hours have passed.
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days <= 0) {
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The same stamp shaped to finish a sentence: "…last talked yesterday". */
function lastTalkedPhrase(iso?: string): string {
  const label = formatLastInteraction(iso);
  if (!label) return '';
  if (label === 'Yesterday' || label === 'Just now') return label.toLowerCase();
  return label.endsWith(' ago') ? label : `on ${label}`;
}

type DayPart = 'late' | 'morning' | 'afternoon' | 'evening';

function dayPart(h: number): DayPart {
  if (h < 5) return 'late';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function greetingFor(part: DayPart, name: string): string {
  // The name is genuinely empty until the profile loads, and it used to fall
  // back to "Aria" app-wide. Greet without a name rather than with a stranger's.
  const suffix = name ? `, ${name}` : '';
  switch (part) {
    case 'late': return name ? `Can’t sleep, ${name}?` : 'Can’t sleep?';
    case 'morning': return `Good morning${suffix}`;
    case 'afternoon': return `Good afternoon${suffix}`;
    case 'evening': return `Good evening${suffix}`;
  }
}

// The check-in follows the same clock as the greeting, so a morning greeting
// is never followed by "How are you arriving tonight?".
const CHECK_IN_COPY: Record<DayPart, { eyebrow: string; prompt: string }> = {
  late: { eyebrow: 'Late-night check-in', prompt: 'How are you holding up?' },
  morning: { eyebrow: 'This morning’s check-in', prompt: 'How are you starting today?' },
  afternoon: { eyebrow: 'This afternoon’s check-in', prompt: 'How is your day going?' },
  evening: { eyebrow: 'Tonight’s check-in', prompt: CHECK_IN.prompt },
};

/** One line under the greeting, built only from what actually happened. */
function leadLine(lead: Companion): string {
  const when = lastTalkedPhrase(lead.lastInteractionAt);
  return when ? `You and ${lead.name} last talked ${when}.` : `${lead.name} is ready when you are.`;
}

// Monday-first narrow weekday letters in the device's language (1 Jan 2024
// was a Monday), so the strip matches the localised date above it.
const WEEKDAYS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
function weekdayLetters(): string[] {
  try {
    const letters = WEEKDAYS_EN.map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: 'narrow' }));
    return letters.every(Boolean) ? letters : WEEKDAYS_EN;
  } catch {
    return WEEKDAYS_EN;
  }
}

// ─── Activity (streak + week) ────────────────────────────────────────────
// Home remounts on every visit, so the last answer is kept for the session
// and painted at once while a fresh one loads; that is what stops the streak
// pill and the week strip from popping in on every return. It is keyed by
// the auth token so a second account on the same phone never sees the
// first one's numbers.
const ACTIVITY_STALE_MS = 30_000;
let activityMemo: { token: string | null; data: ApiActivity; at: number } | null = null;
const currentMemo = () => (activityMemo && activityMemo.token === getAuthToken() ? activityMemo : null);

function useActivity() {
  const [activity, setActivity] = useState<ApiActivity | null>(() => currentMemo()?.data ?? null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback((force: boolean): Promise<void> => {
    const memo = currentMemo();
    if (!force && memo && Date.now() - memo.at < ACTIVITY_STALE_MS) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const token = getAuthToken();
    const request = getActivity()
      .then(
        data => {
          activityMemo = { token, data, at: Date.now() };
          setActivity(data);
          setFailed(false);
        },
        // No numbers is better than invented ones: keep whatever is showing.
        () => setFailed(true),
      )
      .finally(() => { inFlight.current = null; });
    inFlight.current = request;
    return request;
  }, []);

  // On arrival and whenever the app comes back to the foreground (throttled
  // by the memo's age), so a streak earned in a call shows on return.
  const active = useAppActive();
  useEffect(() => {
    if (active) load(false);
  }, [active, load]);

  const reload = useCallback(() => load(true), [load]);
  return { activity, pending: activity === null && !failed, reload };
}

// ─── Entrances ───────────────────────────────────────────────────────────
// The companion stagger plays once per app session. Returning to Home shows
// the list in place; only cards that arrive while Home is open fade in.
let listEnteredThisSession = false;
const STAGGER_MS = 60;

type Entrance = 'stagger' | 'fade' | 'none';

/** Enters (and leaves) with the shared presets; list items also glide when
 *  the order changes. The presets are read once, at mount. */
function Appear({ entrance, index = 0, reflow = false, style, children }: {
  entrance: Entrance;
  index?: number;
  reflow?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const [entering] = useState(() =>
    entrance === 'stagger' ? enter.fadeUp.delay(Math.min(index, 5) * STAGGER_MS)
      : entrance === 'fade' ? enter.fadeUp
        : undefined);
  const [exiting] = useState(() => exit.fade);
  return (
    <Animated.View entering={entering} exiting={exiting} layout={reflow ? layout : undefined} style={style}>
      {children}
    </Animated.View>
  );
}

// ─── Account button ──────────────────────────────────────────────────────
// The header's way into settings: an aurora ring around the user's initial.
const ACCOUNT_SIZE = 40;
const ACCOUNT_RING = [W.coral, W.rose, W.violet, W.coral] as const;

function AccountButton({ name, onPress }: { name: string; onPress: () => void }) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall });
  // Array.from keeps an emoji or accented first letter whole.
  const initial = Array.from(name.trim())[0]?.toUpperCase();
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={minTarget(ACCOUNT_SIZE)}
        accessibilityRole="button"
        accessibilityLabel="Account and settings"
        style={styles.account}
      >
        <LinearGradient colors={ACCOUNT_RING} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.accountInner}>
          {initial ? (
            <Txt variant="subhead" weight={600} maxScale={1.2} style={{ color: W.cream }}>{initial}</Txt>
          ) : (
            <NavIcon name="gear" color={W.cream} size={18} />
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Check-in card ───────────────────────────────────────────────────────
// The daily ritual: a gold eyebrow (it feeds the streak), the aurora edge of a
// live card, and one-tap mood answers that open the chat with the mood as a
// draft. Without a way to carry the mood, it is one honest "check in" button.
const MOOD_BEAT_MS = MOTION.duration.fast;
const BLOOM = [{ offset: 0, color: W.primary, opacity: 0.16 }, { offset: 0.65, color: W.primary, opacity: 0 }] as const;

function CheckInCard({ lead, part, streak, streakPending, entrance, onMood, onOpen }: {
  lead: Companion;
  part: DayPart;
  streak: number | null;
  streakPending: boolean;
  entrance: Entrance;
  onMood?: (mood: string) => void;
  onOpen: () => void;
}) {
  const copy = CHECK_IN_COPY[part];
  const [chosen, setChosen] = useState<string | null>(null);
  // Read through a ref so a parent re-render during the beat doesn't restart it.
  const onMoodRef = useRef(onMood);
  onMoodRef.current = onMood;

  // The chosen chip lights up for a beat before the chat opens, so the tap
  // reads as an answer rather than a jump.
  useEffect(() => {
    if (!chosen) return;
    const id = setTimeout(() => {
      onMoodRef.current?.(chosen);
      setChosen(null);
    }, MOOD_BEAT_MS);
    return () => clearTimeout(id);
  }, [chosen]);

  return (
    <Card tone="live" padding={SP.base} style={styles.checkIn}>
      <View pointerEvents="none" style={styles.bloom}>
        <RadialGlow width={150} height={150} stops={BLOOM} />
      </View>

      <Txt variant="eyebrow" style={{ color: W.gold }}>{copy.eyebrow}</Txt>
      <Txt variant="headline" heading style={styles.prompt}>{copy.prompt}</Txt>

      {onMood ? (
        <View style={styles.moods}>
          {CHECK_IN.moods.map(m => (
            <Pill
              key={m}
              size="sm"
              selected={chosen === m}
              accessibilityRole="button"
              accessibilityHint={`Opens a chat with ${lead.name} with this as a draft`}
              onPress={() => { if (!chosen) setChosen(m); }}
            >
              {m}
            </Pill>
          ))}
        </View>
      ) : (
        <PrimaryButton variant="secondary" haptic={false} onPress={onOpen} style={styles.checkInButton}>
          {`Check in with ${lead.name}`}
        </PrimaryButton>
      )}

      {/* Only claim a streak that exists. On the first visit the row's space
          is held while the numbers load, so the list below doesn't jump. */}
      {streak && streak > 0 ? (
        <Appear entrance={entrance} style={styles.streakRow}>
          <NavIcon name="flame-solid" color={W.gold} size={12} />
          <Txt variant="footnote" style={{ color: W.text3, flexShrink: 1 }}>Keeps your {streak}-day streak alive</Txt>
        </Appear>
      ) : streakPending ? (
        <Skeleton width="55%" height={12} style={styles.streakSkeleton} />
      ) : null}
    </Card>
  );
}

function CheckInSkeleton() {
  return (
    <Card tone="live" padding={SP.base} style={styles.checkIn}>
      <Skeleton width="38%" height={11} />
      <Skeleton width="72%" height={18} style={styles.skeletonGap} />
      <View style={styles.moods}>
        {[64, 70, 82, 62].map((w, i) => <Skeleton key={i} width={w} height={36} radius={R.pill} />)}
      </View>
    </Card>
  );
}

// ─── Companion card ──────────────────────────────────────────────────────
// Avatar, name, what they remember, the last message (or an invitation to
// send one: the card opens a text chat), archetype and last-talked stamp, and
// a call button. For VoiceOver the card is one element whose default action
// opens the chat and whose "Call" action starts a call, because iOS hides a
// button nested inside another from the screen reader.
const CALL_SIZE = 42;

function CompanionCard({ companion, compact, onChat, onCall }: {
  companion: Companion;
  compact: boolean;
  onChat: () => void;
  onCall: () => void;
}) {
  const accent = ARCHETYPE_COLORS[companion.archetype] ?? W.primary;
  const archetype = ARCHETYPE_LABEL[companion.archetype] ?? '';
  // Inside a scroll view press-in also fires when a drag begins, so the
  // haptics go on the commit instead.
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle, haptic: false });
  // `||` rather than `??`: an empty string from the backend means "nothing".
  const memory = companion.memoryHighlight || companion.memory || null;
  const preview = companion.lastMessagePreview || null;
  const stamp = formatLastInteraction(companion.lastInteractionAt) || companion.lastTalked || '';
  const spokenStamp = lastTalkedPhrase(companion.lastInteractionAt) || companion.lastTalked || '';

  const call = useCallback(() => {
    haptic.medium();
    onCall();
  }, [onCall]);

  const label = [
    companion.name,
    archetype,
    memory ? `Remembers: ${memory}` : null,
    preview ? `Last message: ${preview}` : null,
    spokenStamp ? `Last talked ${spokenStamp}` : null,
  ].filter(Boolean).join('. ');

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'call') call();
    else if (e.nativeEvent.actionName === 'activate') onChat();
  };

  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onChat}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the chat"
        accessibilityActions={[
          { name: 'activate', label: `Chat with ${companion.name}` },
          { name: 'call', label: `Call ${companion.name}` },
        ]}
        onAccessibilityAction={onAccessibilityAction}
      >
        <Card padding={SP.md2} borderRadius={R.lg} style={styles.cardRow}>
          <Avatar name={companion.name} color={accent} size={compact ? 48 : 56} image={companion.image} breathe={false} />

          <View style={styles.cardText}>
            <Txt variant="headline" numberOfLines={1} style={{ color: W.cream }}>{companion.name}</Txt>

            {memory ? (
              <View style={styles.metaRow}>
                <NavIcon name="sparkle-solid" color={W.gold} size={11} />
                <Txt variant="footnote" numberOfLines={1} style={[styles.metaText, { color: W.gold }]}>
                  Remembers · {memory}
                </Txt>
              </View>
            ) : null}

            <View style={styles.metaRow}>
              <NavIcon name="chat" color={W.text3} size={12} />
              <Txt variant="footnote" numberOfLines={1} style={[styles.metaText, { color: preview ? W.text2 : W.text3 }]}>
                {preview ?? 'Send a message'}
              </Txt>
            </View>

            {/* The archetype sits in the stamp line rather than as a badge
                beside the name, so a long name ellipsises instead of pushing
                the badge into the call button, even at 320pt. */}
            <Txt variant="caption" numberOfLines={1} style={styles.stamp}>
              <Txt variant="caption" weight={600} style={{ color: accent }}>{archetype}</Txt>
              {archetype && stamp ? ' · ' : ''}{stamp}
            </Txt>
          </View>

          <IconButton
            icon="phone"
            label={`Call ${companion.name}`}
            onPress={call}
            size={CALL_SIZE}
            iconSize={17}
            tint={W.primary}
            variant="tinted"
            haptic={false}
          />
        </Card>
      </Pressable>
    </Animated.View>
  );
}

function CompanionSkeleton({ compact }: { compact: boolean }) {
  const size = compact ? 48 : 56;
  return (
    <Card padding={SP.md2} borderRadius={R.lg} style={styles.cardRow}>
      <Skeleton width={size} height={size} radius={size / 2} />
      <View style={[styles.cardText, styles.skeletonText]}>
        <Skeleton width="45%" height={16} />
        <Skeleton width="80%" height={12} />
        <Skeleton width="35%" height={11} />
      </View>
    </Card>
  );
}

// ─── Add companion ───────────────────────────────────────────────────────
function AddCompanionRow({ size, count, max, limitReason, onAdd }: {
  size: number;
  count: number;
  max: number;
  limitReason?: string;
  onAdd?: () => void;
}) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle, haptic: false });
  const atLimit = count >= max || !!limitReason;
  const enabled = !atLimit && !!onAdd;
  const slotsLeft = Math.max(0, max - count);
  const detail = atLimit
    ? limitReason ?? `${max} of ${max} used`
    : `${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left`;

  const add = () => {
    haptic.light();
    onAdd?.();
  };

  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={enabled ? add : undefined}
        onPressIn={enabled ? press.onPressIn : undefined}
        onPressOut={enabled ? press.onPressOut : undefined}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={atLimit ? `Add a companion, unavailable. ${detail}` : `Add a companion. ${detail}`}
        accessibilityState={{ disabled: !enabled }}
        style={[styles.addRow, atLimit ? styles.addRowOff : styles.addRowOn]}
      >
        <View style={[styles.addIcon, { width: size, height: size, borderRadius: size / 2 }, atLimit ? styles.addIconOff : styles.addIconOn]}>
          <NavIcon name="plus" color={atLimit ? W.text3 : W.primary} size={22} />
        </View>
        <View style={styles.cardText}>
          <Txt variant="headline" numberOfLines={1} style={{ color: atLimit ? W.text2 : W.cream }}>
            {atLimit ? 'Companion limit reached' : 'Add a companion'}
          </Txt>
          <Txt variant="footnote" numberOfLines={2} style={styles.addDetail}>{detail}</Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Week strip ──────────────────────────────────────────────────────────
// Seven bars, Monday first. Today's bar is the only one that gets the aurora
// — everything else stays neutral so the eye lands on "today".
const BAR_MAX = 36;
const BAR_MIN = 6;

function WeekStrip({ activity, entrance }: { activity: ApiActivity; entrance: Entrance }) {
  const bars = activity.week_minutes.slice(0, 7);
  const peak = Math.max(...bars, 1);
  const total = activity.week_total_minutes;
  const prev = activity.prev_week_total_minutes;
  // No delta on a first week — "+100%" against zero is arithmetic, not insight.
  const delta = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null;
  const letters = useMemo(weekdayLetters, []);
  // JS weeks start on Sunday; this strip starts on Monday.
  const todayIdx = (new Date().getDay() + 6) % 7;

  const spoken = [
    `Your week: ${total} minute${total === 1 ? '' : 's'} talked`,
    delta === null ? null : delta === 0 ? 'the same as last week' : `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}% from last week`,
    `today ${bars[todayIdx] ?? 0} minute${bars[todayIdx] === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');

  return (
    <Appear entrance={entrance} style={styles.week}>
      <View accessible accessibilityLabel={spoken} style={styles.weekCard}>
        <View style={styles.weekHead}>
          <Txt variant="eyebrow" style={{ color: W.text2 }}>Your week</Txt>
          <Txt variant="footnote" weight={600} style={[styles.tabular, { color: W.gold }]}>
            {total} min{delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta}%`}
          </Txt>
        </View>

        <View style={styles.bars}>
          {bars.map((v, i) => {
            const h = Math.max(BAR_MIN, Math.round((v / peak) * BAR_MAX));
            return (
              <View key={i} style={styles.barCell}>
                {i === todayIdx ? (
                  // An opaque, rounded wrapper so iOS can build a shadow path
                  // for the glow instead of rendering it offscreen each frame.
                  <View style={[styles.barToday, { height: h }]}>
                    <LinearGradient colors={GRAD.aurora} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.barFill} />
                  </View>
                ) : (
                  <View style={[styles.bar, { height: h }]} />
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.days}>
          {letters.map((d, i) => (
            <Txt
              key={i}
              variant="caption"
              weight={i === todayIdx ? 600 : 500}
              maxScale={1.2}
              style={[styles.day, { color: i === todayIdx ? W.primarySoft : W.text3 }]}
            >
              {d}
            </Txt>
          ))}
        </View>
      </View>
    </Appear>
  );
}

// ─── S10 HOME ──────────────────────────────────────────────────────────────
export function S10_Home({
  go, companions, onSelectCompanion, onCallCompanion, userName, onAddCompanion, maxCompanions,
  status = 'ready', onRetry, onRefresh, onMood, companionLimitReason,
}: {
  go: Go;
  companions: Companion[];
  userName: string;
  onSelectCompanion: (c: Companion) => void;
  onCallCompanion: (c: Companion) => void;
  /** Absent when Home is only a backdrop; the add row is then inert. */
  onAddCompanion?: () => void;
  maxCompanions: number;
  /** Where the companion list stands. While loading with nothing to show,
   *  skeletons hold the layout; an error offers a retry. */
  status?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
  /** Pull-to-refresh: refetches the companions. */
  onRefresh?: () => Promise<void>;
  /** A check-in mood was picked: open the chat with it as a draft. */
  onMood?: (c: Companion, mood: string) => void;
  /** Why no companion can be added right now, when the server has said so. */
  companionLimitReason?: string;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const avatarSize = compact ? 48 : 56;
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();

  // useActivity follows the app's foreground state, so Home re-renders on
  // return and the greeting and date below are recomputed then.
  const { activity, pending: activityPending, reload: reloadActivity } = useActivity();

  const now = new Date();
  const part = dayPart(now.getHours());
  const greeting = greetingFor(part, userName.trim());
  const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const lead: Companion | undefined = companions[0];
  const hasData = companions.length > 0;
  const loadingEmpty = status === 'loading' && !hasData;
  const failedEmpty = status === 'error' && !hasData;
  const staleError = status === 'error' && hasData;
  const empty = status === 'ready' && !hasData;

  // Something that appears after Home has mounted fades in; what is already
  // there on arrival does not replay its entrance.
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  const lateEntrance: Entrance = mounted.current ? 'fade' : 'none';
  const cardEntrance: Entrance = !listEnteredThisSession ? 'stagger' : lateEntrance;
  useEffect(() => {
    if (hasData) listEnteredThisSession = true;
  }, [hasData]);

  // Retry shows as busy only while there is something to wait on: the
  // router's retry if it hands back a promise, otherwise the status change
  // (to loading, then ready) is the feedback. Never a spinner with nothing
  // behind it.
  const [retrying, setRetrying] = useState(false);
  useEffect(() => { setRetrying(false); }, [status]);
  const retry = useCallback(() => {
    const pending: unknown = onRetry ? onRetry() : onRefresh?.();
    if (!isThenable(pending)) return;
    setRetrying(true);
    pending.then(() => setRetrying(false), () => setRetrying(false));
  }, [onRetry, onRefresh]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([onRefresh?.(), reloadActivity()]);
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, reloadActivity]);

  const streak = activity?.streak_days ?? 0;

  // A second tap on the Home tab scrolls back to the top.
  const scrollRef = useRef<ScrollView>(null);
  useTabReselect('home', () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  return (
    <Screen tabBar>
      {/* Exits are for things leaving while Home stays. Without this,
          Reanimated would play every card's fade-out over the next screen
          whenever Home itself is navigated away from. */}
      <LayoutAnimationConfig skipExiting>
        <TopBar
          left={
            <View style={styles.brand}>
              <View style={styles.brandDot} />
              <Txt font="display" weight={700} maxScale={1.2} style={styles.wordmark}>evarna</Txt>
            </View>
          }
          right={
            <View style={styles.headerRight}>
              {streak > 0 ? (
                <Appear entrance={lateEntrance}>
                  <StreakPill days={streak} onPress={() => go('settings')} />
                </Appear>
              ) : null}
              <AccountButton name={userName} onPress={() => go('settings')} />
            </View>
          }
        />

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: tabBarHeight + SP.base }}
          scrollIndicatorInsets={{ bottom: Math.max(0, tabBarHeight - insets.bottom) }}
          refreshControl={onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={W.primary} colors={[W.primary]} />
          ) : undefined}
        >
          {/* Greeting */}
          <View style={styles.greeting}>
            <Txt variant="eyebrow" style={styles.date}>{dateStr}</Txt>
            <Txt variant="hero" heading style={{ color: W.cream }}>{greeting}</Txt>
            {lead ? (
              <Txt variant="subhead" style={styles.leadLine}>{leadLine(lead)}</Txt>
            ) : loadingEmpty ? (
              <Skeleton width="70%" height={13} style={styles.leadSkeleton} />
            ) : null}
          </View>

          {lead ? (
            <Appear entrance={lateEntrance}>
              <CheckInCard
                lead={lead}
                part={part}
                streak={activity ? streak : null}
                streakPending={activityPending}
                entrance={lateEntrance}
                onMood={onMood ? mood => onMood(lead, mood) : undefined}
                onOpen={() => onSelectCompanion(lead)}
              />
            </Appear>
          ) : loadingEmpty ? (
            <Appear entrance="none">
              <CheckInSkeleton />
            </Appear>
          ) : null}

          {/* Companions */}
          <View style={styles.sectionHead}>
            <Txt variant="eyebrow" heading style={{ color: W.text2, flexShrink: 1 }}>Your companions</Txt>
            {hasData ? (
              <Txt
                variant="caption"
                accessibilityLabel={`${companions.length} of ${maxCompanions} companions`}
                style={[styles.tabular, { color: W.textMuted }]}
              >
                {companions.length} of {maxCompanions}
              </Txt>
            ) : null}
          </View>

          {staleError ? (
            <InlineNotice
              tone="warning"
              text="Couldn’t refresh your companions. Check your connection."
              actionLabel="Retry"
              onAction={retry}
              style={styles.notice}
            />
          ) : null}

          {loadingEmpty ? (
            // No entrance (it is what shows first), but it fades out under the
            // arriving cards instead of vanishing.
            <Appear entrance="none" style={styles.list}>
              <View accessible accessibilityLabel="Loading your companions" accessibilityState={{ busy: true }} style={styles.listGap}>
                <CompanionSkeleton compact={compact} />
                <CompanionSkeleton compact={compact} />
              </View>
            </Appear>
          ) : failedEmpty ? (
            <ErrorState
              title="Couldn’t load your companions"
              body="Check your connection and try again."
              onRetry={onRetry || onRefresh ? retry : undefined}
              retryLabel="Retry"
              retrying={retrying}
            />
          ) : empty ? (
            <EmptyState
              icon="sparkle"
              title="No companions yet"
              body="Add a companion to start talking, by text or by voice."
              actionLabel={onAddCompanion ? 'Add a companion' : undefined}
              onAction={onAddCompanion}
            />
          ) : (
            <View style={[styles.list, styles.listGap]}>
              {companions.map((c, index) => (
                <Appear key={String(c.id)} entrance={cardEntrance} index={index} reflow>
                  <CompanionCard
                    companion={c}
                    compact={compact}
                    onChat={() => onSelectCompanion(c)}
                    onCall={() => onCallCompanion(c)}
                  />
                </Appear>
              ))}
              <Appear entrance={cardEntrance} index={companions.length} reflow>
                <AddCompanionRow
                  size={avatarSize}
                  count={companions.length}
                  max={maxCompanions}
                  limitReason={companionLimitReason}
                  onAdd={onAddCompanion}
                />
              </Appear>
            </View>
          )}

          {activity && activity.active_days > 0 ? <WeekStrip activity={activity} entrance={lateEntrance} /> : null}
        </ScrollView>
      </LayoutAnimationConfig>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },

  brand: { flexDirection: 'row', alignItems: 'center', gap: SP.sm2 },
  brandDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: W.rose, ...ELEV.glow(W.primary, 10, 0.9) },
  // The wordmark is a logo, not a text role, so it keeps its own size.
  wordmark: { fontSize: 18, color: W.cream, letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SP.sm2 },

  account: { width: ACCOUNT_SIZE, height: ACCOUNT_SIZE, borderRadius: ACCOUNT_SIZE / 2, padding: 2, overflow: 'hidden' },
  accountInner: {
    flex: 1, borderRadius: ACCOUNT_SIZE / 2 - 2, backgroundColor: W.surface1,
    alignItems: 'center', justifyContent: 'center',
  },

  greeting: { paddingHorizontal: GUTTER, paddingTop: SP.sm2, paddingBottom: SP.lg },
  date: { color: W.textMuted, marginBottom: SP.sm2 },
  leadLine: { marginTop: SP.sm, color: W.text2 },
  leadSkeleton: { marginTop: SP.md },

  checkIn: { marginHorizontal: GUTTER, marginBottom: SP.base2 },
  bloom: { position: 'absolute', right: -40, top: -50 },
  prompt: { marginTop: SP.sm, color: W.cream },
  moods: { marginTop: SP.md, flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  checkInButton: { marginTop: SP.md },
  streakRow: { marginTop: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.xs2 },
  streakSkeleton: { marginTop: SP.md },
  skeletonGap: { marginTop: SP.sm2 },

  sectionHead: {
    paddingHorizontal: GUTTER, paddingBottom: SP.sm2, gap: SP.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  notice: { marginHorizontal: GUTTER, marginBottom: SP.sm2 },
  list: { paddingHorizontal: GUTTER },
  listGap: { gap: SP.sm2 },

  cardRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  cardText: { flex: 1, minWidth: 0 },
  skeletonText: { gap: SP.sm },
  metaRow: { marginTop: SP.xs, flexDirection: 'row', alignItems: 'center', gap: SP.xs2 },
  metaText: { flex: 1 },
  stamp: { marginTop: SP.xs, color: W.text3 },

  addRow: {
    minHeight: HIT, borderRadius: R.lg, padding: SP.md2, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
  },
  addRowOn: { borderColor: rgba(W.primary, 0.24), backgroundColor: rgba(W.primary, 0.05) },
  addRowOff: { borderColor: W.hairline, backgroundColor: 'transparent' },
  addIcon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  addIconOn: { borderColor: rgba(W.primary, 0.3) },
  addIconOff: { borderColor: W.hairlineStrong },
  addDetail: { marginTop: SP.xxs, color: W.text3 },

  week: { marginHorizontal: GUTTER, marginTop: SP.base },
  weekCard: {
    borderRadius: R.card, paddingVertical: SP.md2, paddingHorizontal: SP.base,
    backgroundColor: W.glassSoft, borderWidth: 1, borderColor: W.hairlineFaint,
  },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md },
  bars: { marginTop: SP.sm2, height: BAR_MAX, flexDirection: 'row', alignItems: 'flex-end', gap: SP.md2 },
  barCell: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: R.xs, backgroundColor: W.hairlineStrong },
  barToday: { width: '100%', borderRadius: R.xs, backgroundColor: W.rose, ...ELEV.glow(W.rose, 12, 0.4) },
  barFill: { ...StyleSheet.absoluteFillObject, borderRadius: R.xs },
  days: { marginTop: SP.xs, flexDirection: 'row', gap: SP.md2 },
  day: { flex: 1, textAlign: 'center' },
});
