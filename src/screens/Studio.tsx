// Studio.tsx — S15 Studio Home, S16 Scenario Setup, S17 Active Session (with
// its summary and report sheets), S18 Character Creator.

import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS, Alert, Keyboard, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View,
  type AccessibilityActionEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp,
  type TextInputProps, type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring,
  withTiming, type WithTimingConfig,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, TopBar } from '../components/Chrome';
import { useTabBarHeight } from '../components/BottomNav';
import { NavIcon, type IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import {
  BackButton, GlassFill, IconButton, InlineNotice, minTarget, Pill, PrimaryButton, ProgressDots, QuickReply,
  Skeleton, Toggle,
} from '../components/Atoms';
import { Sheet } from '../components/Sheet';
import { Avatar, Waveform, avatarColor } from '../components/Avatar';
import { AiNotice, useAiNoticeRepeat, BubbleMem, CapHitCard, ChatInput, TypingDots } from '../components/ChatBits';
import { aiNoticeText } from '../lib/aiNotice';
import { restoreDraft } from '../lib/chatTurns';
import { haptic } from '../lib/haptics';
import { hasVoicePreview, useVoicePreview } from '../lib/voicePreview';
import { announce, useScreenReader } from '../hooks/useAccessibilityPrefs';
import { canOpenCrisisResource, crisisResources, openCrisisResource, type CrisisResource } from '../data/crisis';
import { messageLimitOf } from './Chat';
import { formatLastInteraction } from './Home';
import { enter, exit, layout, spring, timing, usePressFeedback, useReducedMotion } from '../theme/motion';
import { ELEV, HIT, MOTION, R, resolveFont, rgba, SP, TYPE, W } from '../theme/theme';
import { SCENARIOS, Scenario } from '../data/config';
import {
  ApiGender, ApiMemory, ApiScenario, ApiSession, ApiStudioCharacter, ApiVoice, ReportReason,
  createReport, createStudioCharacter, deleteMemory, deleteStudioCharacter, endSession, getCharacterSessions,
  getConversationTurns, getMemories, startSession,
} from '../api';
import { ApiError, NetworkError, isNetworkError, streamConversation, type SseErrorInfo } from '../api/client';
import { Go } from '../navigation/types';

const D = MOTION.duration;

type LoadStatus = 'loading' | 'ready' | 'error';

// The UI keeps male/female/neutral; the backend enum only knows nonbinary.
type StudioGender = 'male' | 'female' | 'neutral';
const API_GENDER: Record<StudioGender, ApiGender> = { male: 'male', female: 'female', neutral: 'nonbinary' };
const GENDERS: readonly StudioGender[] = ['male', 'female', 'neutral'];
const GENDER_LABEL: Record<StudioGender, string> = { male: 'Male', female: 'Female', neutral: 'Neutral' };

// The backend voice catalog is tagged male/female only, so 'neutral' offers all of them.
const voicesFor = (voices: ApiVoice[], g: StudioGender) =>
  g === 'neutral' ? voices : voices.filter(v => v.gender === g);

// Backend limits (studio.routes.ts CreateStudioSchema).
const NAME_MAX = 30;
const BACKSTORY_MAX = 500;
const REPORT_NOTE_MAX = 1000;

// When the router passes no status, how long an empty list counts as loading
// before the screen says it didn't arrive.
const DATA_WAIT_MS = 8000;
// A session that hasn't started by then fails its queued messages (with Retry).
const SESSION_START_TIMEOUT_MS = 15_000;
// The first send waits this long at most for history to say whether the
// conversation being continued was a remembered one.
const PREF_WAIT_MS = 3000;
// How long "Memory forgotten · Undo" stays; longer while VoiceOver is talking.
const UNDO_MS = 4000;
const UNDO_MS_SCREEN_READER = 10_000;
// Within this distance of the end, new text keeps the thread pinned.
const NEAR_BOTTOM_PX = 80;

const SCENARIO_CARD_W = 160;
const CONTINUE_CARD_W = 220;
const ROW_GAP = SP.md;

const DELETE_ACTIONS = [{ name: 'delete', label: 'Delete' }];
const REPORT_ACTIONS = [{ name: 'report', label: 'Report this reply' }];

// Session fields the ApiSession type doesn't declare but GET /sessions returns.
type SessionWithMemory = ApiSession & { memory_enabled?: boolean };

// ─── Handoffs between Studio screens ─────────────────────────────────────
// The router carries only ids between these screens, so the setup a
// scenario was started with (for S17's opening brief) and the character the
// creator just made (so Studio home can show it at once) pass through here.
interface SetupBrief {
  lines: { label: string; value: string }[];
  /** True until the first message: a setup left without one gets cleaned up. */
  unused: boolean;
}
const setupBriefs = new Map<string, SetupBrief>();
let justCreated: ApiStudioCharacter | null = null;

// ─── Copy for failures ───────────────────────────────────────────────────
function createErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // The server names the real limit ("up to 20 Studio characters…").
    if (e.code === 'STUDIO_LIMIT_REACHED') {
      return e.serverMessage ?? "You've reached the Studio character limit. Delete a character in Studio to make room.";
    }
    if (e.code === 'VALIDATION_ERROR') return "Something here wasn't accepted. Check the details and try again.";
    if (e.status === 429) return 'Too many tries just now. Wait a moment and try again.';
  }
  if (isNetworkError(e)) return "Can't reach Evarna. Check your connection and try again.";
  return 'Something went wrong on our side. Try again in a moment.';
}

function sessionStartMessage(e: unknown): string {
  if (isNetworkError(e)) return "Can't reach Evarna, so the session didn't start.";
  if (e instanceof ApiError && e.status === 429) return 'Too many tries just now. Wait a moment, then retry.';
  if (e instanceof ApiError && e.serverMessage) return e.serverMessage;
  return "Couldn't start the session.";
}

/** Why a message didn't go, when that's known and useful. */
function notSentReason(info?: SseErrorInfo): string | undefined {
  if (info?.status === 429) return 'Too many messages at once.';
  if (isNetworkError(info)) return 'Check your connection.';
  return undefined;
}

// ─── Native confirmations ────────────────────────────────────────────────
// Studio home is a tab root, and the floating tab bar draws above anything a
// screen renders, so its menus use the system action sheet (which also
// matches what iOS uses for destructive confirmations).
function confirmDestructive(o: { title: string; message: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void }) {
  const cancel = o.cancelLabel ?? 'Cancel';
  haptic.warning();
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: o.title, message: o.message, options: [o.confirmLabel, cancel], destructiveButtonIndex: 0, cancelButtonIndex: 1, userInterfaceStyle: 'dark' },
      i => { if (i === 0) o.onConfirm(); },
    );
    return;
  }
  Alert.alert(o.title, o.message, [{ text: cancel, style: 'cancel' }, { text: o.confirmLabel, style: 'destructive', onPress: o.onConfirm }]);
}

function chooseAction(o: { title: string; message?: string; actions: { label: string; onPress: () => void }[] }) {
  if (Platform.OS === 'ios') {
    const options = [...o.actions.map(a => a.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: o.title, message: o.message, options, cancelButtonIndex: options.length - 1, userInterfaceStyle: 'dark' },
      i => o.actions[i]?.onPress(),
    );
    return;
  }
  Alert.alert(o.title, o.message, [{ text: 'Cancel', style: 'cancel' }, ...o.actions.map(a => ({ text: a.label, onPress: a.onPress }))]);
}

// ─── Small hooks ─────────────────────────────────────────────────────────
// Reanimated's layout-animation builders are made fresh on every read, so
// each mount reads one and keeps it.
const useOnce = <T,>(read: () => T): T => useState(read)[0];

// A fade is the calm alternative to movement, so it plays under Reduce Motion.
function calm(ms: number): WithTimingConfig {
  'worklet';
  return { ...timing(ms), reduceMotion: ReduceMotion.Never };
}

/** The router's status when it gives one; otherwise data means ready, and an
 *  empty list is loading until DATA_WAIT_MS passes, then an error. */
function useLoadStatus(hasData: boolean, explicit?: LoadStatus): LoadStatus {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (explicit || hasData) return;
    const t = setTimeout(() => setWaited(true), DATA_WAIT_MS);
    return () => clearTimeout(t);
  }, [explicit, hasData]);
  if (explicit) return explicit;
  if (hasData) return 'ready';
  return waited ? 'error' : 'loading';
}

// ─── Shared pieces ───────────────────────────────────────────────────────
function SectionHeader({ children, marginTop = SP.sm }: { children: React.ReactNode; marginTop?: number }) {
  return (
    <View style={[styles.sectionHeader, { paddingTop: marginTop }]}>
      <Txt variant="eyebrow" heading style={{ color: W.text2 }}>{children}</Txt>
    </View>
  );
}

function FieldLabel({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <View style={styles.fieldLabel}>
      <Txt variant="eyebrow" style={{ color: W.text2, flexShrink: 1 }}>{children}</Txt>
      {note ? <Txt variant="caption" style={{ color: W.text3 }}>{note}</Txt> : null}
    </View>
  );
}

/** A text input on the shared field recipe, with a focus ring. */
const Field = forwardRef<TextInput, TextInputProps>(function Field({ style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={W.placeholder}
      maxFontSizeMultiplier={TYPE.callout.maxScale}
      keyboardAppearance="dark"
      selectionColor={W.primary}
      {...props}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
      style={[styles.input, focused ? styles.inputFocused : null, style]}
    />
  );
});

function IconTile({ icon, accent, size }: { icon: string; accent: string; size: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.3),
        backgroundColor: rgba(accent, 0.12), borderWidth: 1, borderColor: rgba(accent, 0.25),
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <NavIcon name={icon as IconName} color={accent} size={Math.round(size * 0.55)} />
    </View>
  );
}

/** A tappable card that scales under the finger. No haptic: these sit in
 *  scroll views, where a touch-down buzz would fire on every scroll. */
function PressCard({
  onPress, onLongPress, style, contentStyle, children,
  accessibilityLabel, accessibilityHint, accessibilityActions, onAccessibilityAction,
}: {
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityActions?: { name: string; label?: string }[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}) {
  const press = usePressFeedback({ haptic: false });
  return (
    <Animated.View style={[style, press.animatedStyle]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={onAccessibilityAction}
        style={[styles.grow, contentStyle]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// Icon + accent are local styling — the backend only names the scenario.
const studioLook = (c: ApiStudioCharacter) =>
  SCENARIOS.find(s => s.id === c.scenario_id) ?? { icon: 'sparkle', accent: W.secondary };

// ─── Voice picker (S16, S18) ─────────────────────────────────────────────
// Ids are backend voice UUIDs, exactly like S07_Voice. Picking a voice plays
// its bundled sample when this build has one, as the iOS voice pickers do.
function VoicePicker({ voices, catalogSize, gender, voiceId, onPick, status, onRetry }: {
  /** The voices for the chosen gender. */
  voices: ApiVoice[];
  /** How many voices the whole catalog has. */
  catalogSize: number;
  gender: StudioGender;
  voiceId: string | null;
  onPick: (id: string) => void;
  status: LoadStatus;
  onRetry?: () => void;
}) {
  const preview = useVoicePreview();

  if (voices.length === 0) {
    if (catalogSize > 0) {
      return <InlineNotice tone="info" text={`No ${GENDER_LABEL[gender].toLowerCase()} voices yet. Try another option.`} />;
    }
    if (status === 'loading') {
      return (
        <View accessible accessibilityLabel="Loading voices" style={styles.voiceGrid}>
          <Skeleton width="48%" height={116} radius={R.lg} />
          <Skeleton width="48%" height={116} radius={R.lg} />
        </View>
      );
    }
    return (
      <InlineNotice
        tone="error"
        text={status === 'error' ? (onRetry ? "Couldn't load voices." : "Couldn't load voices. Check your connection.") : 'No voices are available right now.'}
        actionLabel={onRetry ? 'Retry' : undefined}
        onAction={onRetry}
      />
    );
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Voice" style={styles.voiceGrid}>
      {voices.map(v => (
        <VoiceCard
          key={v.id}
          voice={v}
          selected={voiceId === v.id}
          playing={preview.playingId === v.id}
          canPreview={hasVoicePreview(v.id)}
          onPress={() => {
            if (voiceId !== v.id) haptic.selection();
            onPick(v.id);
            if (hasVoicePreview(v.id)) preview.play(v.id);
          }}
        />
      ))}
    </View>
  );
}

function VoiceCard({ voice: v, selected, playing, canPreview, onPress }: {
  voice: ApiVoice; selected: boolean; playing: boolean; canPreview: boolean; onPress: () => void;
}) {
  const press = usePressFeedback({ haptic: false });
  return (
    <Animated.View style={[styles.voiceCardOuter, press.animatedStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={v.personality ? `${v.name}. ${v.personality}` : v.name}
        accessibilityHint={canPreview ? 'Selects this voice and plays a sample' : undefined}
        // The border is always drawn, so selecting never shifts the content.
        style={[styles.voiceCard, { borderColor: selected ? W.primary : 'transparent' }]}
      >
        <View style={styles.rowBetween}>
          <Waveform color={selected || playing ? W.primary : W.text3} size={28} animate={playing} />
          {selected ? (
            <View style={styles.checkBadge}>
              <NavIcon name="check" color={W.onAccent} size={12} />
            </View>
          ) : null}
        </View>
        <Txt variant="callout" weight={600} numberOfLines={1}>{v.name}</Txt>
        {v.personality ? <Txt variant="caption" numberOfLines={3} style={{ color: W.text2 }}>{v.personality}</Txt> : null}
        {canPreview ? (
          <Txt variant="caption" weight={500} style={{ color: playing ? W.primarySoft : W.text3 }}>
            {playing ? 'Playing sample…' : 'Tap to hear'}
          </Txt>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function GenderPills({ value, onChange }: { value: StudioGender; onChange: (g: StudioGender) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Voice gender" style={styles.genderRow}>
      {GENDERS.map(g => (
        <Pill key={g} size="sm" selected={value === g} onPress={() => onChange(g)} style={styles.flex1}>
          {GENDER_LABEL[g]}
        </Pill>
      ))}
    </View>
  );
}

// ─── S15 STUDIO HOME ─────────────────────────────────────────────────────
interface StudioHomeProps {
  go: Go;
  characters: ApiStudioCharacter[];
  setupScenario: (s: Scenario) => void;
  openCreator: () => void;
  resumeConvo: (c: ApiStudioCharacter) => void;
  /** State of the characters list; without it the list is taken as ready. */
  status?: LoadStatus;
  onRetry?: () => void;
  onRefresh?: () => Promise<void>;
  /** Deletes a Studio character; defaults to DELETE /studio/characters/:id. */
  onDeleteCharacter?: (id: string) => Promise<void>;
}

export function S15_StudioHome({
  characters, setupScenario, openCreator, resumeConvo, status = 'ready', onRetry, onRefresh, onDeleteCharacter,
}: StudioHomeProps) {
  const tabBarH = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The character the creator just made, shown from the create response
  // until the router's refetch includes it, and pulsed once on arrival.
  const [fresh] = useState(() => justCreated);

  const listed = characters.filter(c => !removed.has(c._id));
  const freshListed = !!fresh && characters.some(c => c._id === fresh._id);
  useEffect(() => {
    if (freshListed && justCreated?._id === fresh?._id) justCreated = null;
  }, [freshListed, fresh]);
  const all = fresh && !freshListed && !removed.has(fresh._id) ? [...listed, fresh] : listed;

  // "Continue" is every studio character that has actually been talked to.
  const activeConvos = all.filter(c => !!c.last_interaction_at);
  const customs = all.filter(c => c.kind === 'custom');
  const showSkeleton = status === 'loading' && listed.length === 0;

  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The router reports a failed refresh through `status`.
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const remove = async (c: ApiStudioCharacter) => {
    setDeleteError(null);
    setRemoved(s => new Set(s).add(c._id));
    if (justCreated?._id === c._id) justCreated = null;
    try {
      await (onDeleteCharacter ?? deleteStudioCharacter)(c._id);
      announce(`${c.name} deleted.`);
    } catch (e) {
      // Already gone on the server: the goal is met.
      if (e instanceof ApiError && e.status === 404) {
        announce(`${c.name} deleted.`);
        return;
      }
      setRemoved(s => {
        const next = new Set(s);
        next.delete(c._id);
        return next;
      });
      haptic.error();
      setDeleteError(`Couldn't delete ${c.name}. ${isNetworkError(e) ? 'Check your connection and try again.' : 'Try again in a moment.'}`);
    }
  };

  const askDelete = (c: ApiStudioCharacter) => confirmDestructive({
    title: `Delete ${c.name}?`,
    message: `${c.name} will be removed from Studio, and you won't be able to go back to your conversations with them. This can't be undone.`,
    confirmLabel: 'Delete character',
    onConfirm: () => { void remove(c); },
  });

  const openScenario = (s: Scenario) => {
    const existing = activeConvos.find(c => c.scenario_id === s.id);
    if (!existing) return setupScenario(s);
    const when = formatLastInteraction(existing.last_interaction_at);
    chooseAction({
      title: s.name,
      message: when ? `Last session: ${when}.` : undefined,
      actions: [
        { label: 'Continue where you left off', onPress: () => resumeConvo(existing) },
        { label: 'Start a new setup', onPress: () => setupScenario(s) },
      ],
    });
  };

  return (
    <Screen tabBar>
      <TopBar
        left={<Txt variant="title2" weight={700} heading>Studio</Txt>}
        right={<CreateButton onPress={openCreator} />}
      />
      <ScrollView
        style={styles.flex1}
        // Content scrolls on under the floating tab bar and clears it at the end.
        contentContainerStyle={{ paddingBottom: tabBarH + SP.base }}
        scrollIndicatorInsets={{ bottom: Math.max(0, tabBarH - insets.bottom) }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={W.text2} /> : undefined}
      >
        {status === 'error' ? (
          <InlineNotice
            tone="error"
            text={listed.length ? "Couldn't refresh your characters." : "Couldn't load your characters."}
            actionLabel={onRetry ? 'Retry' : undefined}
            onAction={onRetry}
            style={styles.homeNotice}
          />
        ) : null}
        {deleteError ? <InlineNotice tone="error" text={deleteError} style={styles.homeNotice} /> : null}

        {/* CONTINUE — conversations in progress. The list endpoint has no
            message preview, so that line is left out rather than invented. */}
        {activeConvos.length > 0 ? (
          <>
            <SectionHeader>Continue</SectionHeader>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={CONTINUE_CARD_W + ROW_GAP}
              snapToAlignment="start"
              decelerationRate="fast"
              contentContainerStyle={styles.cardRow}
            >
              {activeConvos.map(c => (
                <ContinueCard key={c._id} character={c} onPress={() => resumeConvo(c)} onOptions={() => askDelete(c)} />
              ))}
            </ScrollView>
          </>
        ) : null}

        <SectionHeader marginTop={activeConvos.length ? SP.xl : SP.sm}>Ready-made scenarios</SectionHeader>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SCENARIO_CARD_W + ROW_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={styles.cardRow}
        >
          {SCENARIOS.map(s => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              inProgress={activeConvos.some(c => c.scenario_id === s.id)}
              onPress={() => openScenario(s)}
            />
          ))}
        </ScrollView>

        {/* Your characters — custom ones only; scenario runs live in the rows above. */}
        <SectionHeader marginTop={SP.xl}>Your characters</SectionHeader>
        <View style={styles.gutter}>
          {customs.length === 0 && !showSkeleton ? (
            // After a failed load the notice above says so; "create your first"
            // would claim there are none.
            status === 'error' ? null : <CreateFirstCard onPress={openCreator} />
          ) : (
            <View
              accessible={showSkeleton && customs.length === 0}
              accessibilityLabel={showSkeleton && customs.length === 0 ? 'Loading your characters' : undefined}
              style={styles.tileGrid}
            >
              {customs.map(c => (
                <CharacterTile
                  key={c._id}
                  character={c}
                  highlight={c._id === fresh?._id}
                  onPress={() => resumeConvo(c)}
                  onOptions={() => askDelete(c)}
                />
              ))}
              {showSkeleton ? (
                <>
                  <Skeleton width="48%" height={112} radius={R.lg} />
                  {customs.length === 0 ? <Skeleton width="48%" height={112} radius={R.lg} /> : null}
                </>
              ) : (
                <AddTile onPress={openCreator} />
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function CreateButton({ onPress }: { onPress: () => void }) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall });
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={minTarget(88, 34)}
        accessibilityRole="button"
        accessibilityLabel="Create a character"
        style={({ pressed }) => [styles.createButton, pressed ? styles.pressed : null]}
      >
        <NavIcon name="plus" color={W.primarySoft} size={16} />
        <Txt variant="subhead" weight={600} maxScale={1.3} style={{ color: W.primarySoft }}>Create</Txt>
      </Pressable>
    </Animated.View>
  );
}

function ContinueCard({ character: c, onPress, onOptions }: { character: ApiStudioCharacter; onPress: () => void; onOptions: () => void }) {
  const look = studioLook(c);
  const when = formatLastInteraction(c.last_interaction_at);
  const sessions = c.total_sessions ? `${c.total_sessions} ${c.total_sessions === 1 ? 'session' : 'sessions'}` : '';
  return (
    <PressCard
      onPress={onPress}
      onLongPress={() => { haptic.medium(); onOptions(); }}
      accessibilityLabel={[c.name, when, sessions].filter(Boolean).join(', ')}
      accessibilityHint="Continues the conversation"
      accessibilityActions={DELETE_ACTIONS}
      onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'delete') onOptions(); }}
      style={{ width: CONTINUE_CARD_W }}
      contentStyle={[styles.glassCard, styles.continueCard, { borderColor: rgba(look.accent, 0.15) }]}
    >
      <GlassFill intensity={20} />
      <View style={styles.rowCenter}>
        {c.kind === 'custom'
          ? <Avatar name={c.name} glyph="initials" color={avatarColor(c._id)} size={36} breathe={false} />
          : <IconTile icon={look.icon} accent={look.accent} size={36} />}
        <View style={styles.shrink}>
          <Txt variant="callout" weight={600} numberOfLines={1}>{c.name}</Txt>
          {when ? <Txt variant="caption" numberOfLines={1} style={{ color: W.text2 }}>{when}</Txt> : null}
        </View>
        <IconButton icon="kebab" label={`More options for ${c.name}`} onPress={onOptions} size={32} iconSize={18} tint={W.text2} haptic={false} />
      </View>
      {sessions ? (
        <View style={styles.rowTight}>
          <NavIcon name="chat" color={W.text3} size={14} />
          <Txt variant="caption" style={{ color: W.text2 }}>{sessions}</Txt>
        </View>
      ) : null}
    </PressCard>
  );
}

function ScenarioCard({ scenario: s, inProgress, onPress }: { scenario: Scenario; inProgress: boolean; onPress: () => void }) {
  return (
    <PressCard
      onPress={onPress}
      accessibilityLabel={`${s.name}. ${s.desc}${inProgress ? '. In progress' : ''}`}
      accessibilityHint={inProgress ? 'Continue it or start a new setup' : 'Opens the setup'}
      style={{ width: SCENARIO_CARD_W }}
      contentStyle={[styles.glassCard, styles.scenarioCard, { borderColor: rgba(s.accent, 0.12) }]}
    >
      <GlassFill intensity={20} />
      <View style={styles.rowBetween}>
        <IconTile icon={s.icon} accent={s.accent} size={40} />
        {inProgress ? (
          <View style={[styles.badge, { backgroundColor: rgba(s.accent, 0.15) }]}>
            <Txt variant="caption" weight={600} maxScale={1.2} style={{ color: s.accent }}>In progress</Txt>
          </View>
        ) : null}
      </View>
      <View style={styles.gapXs}>
        <Txt variant="callout" weight={600}>{s.name}</Txt>
        <Txt variant="footnote" style={{ color: W.text2 }}>{s.desc}</Txt>
      </View>
    </PressCard>
  );
}

function CharacterTile({ character: c, highlight, onPress, onOptions }: {
  character: ApiStudioCharacter; highlight: boolean; onPress: () => void; onOptions: () => void;
}) {
  const reduced = useReducedMotion();
  const exiting = useOnce(() => exit.scaleOut);
  const ring = useSharedValue(highlight ? 1 : 0);
  const pop = useSharedValue(1);
  const when = formatLastInteraction(c.last_interaction_at);

  // One pulse for a character that was just created; the ring fades after.
  useEffect(() => {
    if (!highlight) return;
    if (!reduced) pop.value = withSequence(withTiming(1.04, timing(D.fast, 'decel')), withSpring(1, spring('bouncy')));
    ring.value = withDelay(D.slower, withTiming(0, calm(D.slower)));
  }, [highlight, reduced, pop, ring]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));

  return (
    <Animated.View layout={layout} exiting={exiting} style={[styles.tileOuter, popStyle]}>
      <PressCard
        onPress={onPress}
        onLongPress={() => { haptic.medium(); onOptions(); }}
        accessibilityLabel={when ? `${c.name}, ${when}` : c.name}
        accessibilityHint="Continues the conversation"
        accessibilityActions={DELETE_ACTIONS}
        onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'delete') onOptions(); }}
        style={styles.grow}
        contentStyle={styles.tile}
      >
        <View style={styles.rowBetween}>
          <Avatar name={c.name} glyph="initials" color={avatarColor(c._id)} size={40} breathe={false} />
          <IconButton icon="kebab" label={`More options for ${c.name}`} onPress={onOptions} size={32} iconSize={18} tint={W.text2} haptic={false} />
        </View>
        <Txt variant="callout" weight={600} numberOfLines={1} style={styles.tileName}>{c.name}</Txt>
        <Txt variant="caption" numberOfLines={1} style={{ color: W.text2 }}>{when || 'Not started yet'}</Txt>
        <Animated.View pointerEvents="none" style={[styles.tileRing, ringStyle]} />
      </PressCard>
    </Animated.View>
  );
}

function AddTile({ onPress }: { onPress: () => void }) {
  return (
    <PressCard
      onPress={onPress}
      accessibilityLabel="Create a character"
      style={styles.tileOuter}
      contentStyle={[styles.dashed, styles.addTile]}
    >
      <NavIcon name="plus" color={W.text2} />
      <Txt variant="footnote" weight={500} style={{ color: W.text2 }}>Add</Txt>
    </PressCard>
  );
}

function CreateFirstCard({ onPress }: { onPress: () => void }) {
  return (
    <PressCard onPress={onPress} accessibilityLabel="Create your own character" contentStyle={[styles.dashed, styles.createFirst]}>
      <View style={styles.createFirstIcon}>
        <NavIcon name="plus" color={W.primarySoft} />
      </View>
      <Txt variant="headline" style={styles.center}>Create your own character</Txt>
      <Txt variant="subhead" style={[styles.center, { color: W.text2 }]}>
        Give them a name, a voice and a personality, then talk it through.
      </Txt>
    </PressCard>
  );
}

// ─── S16 SCENARIO SETUP ──────────────────────────────────────────────────
// The form is rendered from GET /studio/scenarios: the server owns the param
// definitions and the persona that consumes them, so there is nothing to drift.
export function S16_ScenarioSetup({
  go, scenario, def, apiVoices = [], onStart, defStatus, onRetry, voicesStatus, onRetryVoices,
}: {
  go: Go;
  scenario: Scenario;
  def?: ApiScenario;
  apiVoices?: ApiVoice[];
  onStart: (characterId: string, remember: boolean) => void;
  /** State of the scenario definitions. */
  defStatus?: LoadStatus;
  /** Refetches the scenario definitions (and the voices, if those failed too). */
  onRetry?: () => void;
  voicesStatus?: LoadStatus;
  onRetryVoices?: () => void;
}) {
  const [gender, setGender] = useState<StudioGender>('female');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  // Handed up with the character id; S17 owns the session, so it passes this
  // to startSession rather than S16 starting one just to carry the flag.
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef<Record<string, TextInput | null>>({});

  const setupStatus = useLoadStatus(!!def, defStatus);
  const voiceStatus = useLoadStatus(apiVoices.length > 0, voicesStatus);
  const retryVoices = onRetryVoices ?? onRetry;

  // Arriving after a failed load: ask again rather than wait for a tap.
  useEffect(() => {
    const setupFailed = !def && defStatus === 'error';
    const voicesFailed = apiVoices.length === 0 && voicesStatus === 'error';
    if (setupFailed) onRetry?.();
    // One call when a single retry covers both.
    if (voicesFailed && !(setupFailed && retryVoices === onRetry)) retryVoices?.();
    // Mount only: later failures are the Retry button's job.
  }, []);

  const name = def?.name ?? scenario.name;
  const voiceList = voicesFor(apiVoices, gender);
  const pickedVoice = voiceList.some(v => v.id === voiceId) ? voiceId : voiceList[0]?.id ?? null;
  const fields = def?.params ?? [];
  const missing = fields.filter(p => p.required && !(params[p.key] ?? '').trim());
  const textKeys = fields.filter(p => p.type === 'text').map(p => p.key);
  const hint = !def ? null
    : !pickedVoice ? 'Pick a voice to start.'
    : missing.length ? `Still needed: ${missing.map(p => p.label).join(', ')}`
    : null;

  const setParam = (key: string, value: string) => setParams(v => ({ ...v, [key]: value }));

  const start = async () => {
    if (!def || !pickedVoice || missing.length || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setErr(null);
    try {
      const res = await createStudioCharacter({
        kind: 'scenario',
        scenario_id: def.id,
        params,
        voice_id: pickedVoice,
        gender: API_GENDER[gender],
      });
      setupBriefs.set(res.character_id, {
        lines: def.params
          .map(p => ({ label: p.label, value: (params[p.key] ?? '').trim() }))
          .filter(l => l.value),
        unused: true,
      });
      onStart(res.character_id, remember);
    } catch (e) {
      haptic.error();
      setErr(createErrorMessage(e));
      setBusy(false);
    }
  };

  const rememberCopy = remember
    ? `Your ${name} will remember this across sessions.`
    : 'One-time session. Nothing from it is saved to memory.';

  return (
    <Screen>
      <TopBar
        left={<BackButton onPress={() => go('studio')} />}
        center={
          <View accessible accessibilityRole="header" accessibilityLabel={name} style={styles.titleRow}>
            <IconTile icon={scenario.icon} accent={scenario.accent} size={24} />
            <Txt variant="headline" numberOfLines={1} style={styles.shrinkText}>{name}</Txt>
          </View>
        }
      />
      <ScrollView
        style={styles.flex1}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View>
          <FieldLabel>Voice gender</FieldLabel>
          <GenderPills value={gender} onChange={setGender} />
        </View>
        <View>
          <FieldLabel>Voice</FieldLabel>
          <VoicePicker
            voices={voiceList} catalogSize={apiVoices.length} gender={gender} voiceId={pickedVoice} onPick={setVoiceId}
            status={voiceStatus} onRetry={retryVoices}
          />
        </View>

        {def ? fields.map(p => {
          const value = params[p.key] ?? '';
          const next = textKeys[textKeys.indexOf(p.key) + 1];
          return (
            <View key={p.key}>
              <FieldLabel note={p.required && !value.trim() ? 'Required' : undefined}>{p.label}</FieldLabel>
              {p.type === 'choice' ? (
                <View accessibilityRole="radiogroup" accessibilityLabel={p.label} style={styles.wrapRow}>
                  {(p.options ?? []).map(opt => (
                    <Pill key={opt} size="sm" selected={value === opt} onPress={() => setParam(p.key, opt)}>{opt}</Pill>
                  ))}
                </View>
              ) : (
                <Field
                  ref={r => { inputs.current[p.key] = r; }}
                  value={value}
                  onChangeText={v => setParam(p.key, v)}
                  placeholder={p.placeholder}
                  accessibilityLabel={p.required ? `${p.label}, required` : p.label}
                  autoCapitalize="sentences"
                  returnKeyType={next ? 'next' : 'done'}
                  submitBehavior={next ? 'submit' : 'blurAndSubmit'}
                  onSubmitEditing={() => { if (next) inputs.current[next]?.focus(); }}
                />
              )}
            </View>
          );
        }) : setupStatus === 'loading' ? (
          <View accessible accessibilityLabel="Loading the setup" style={styles.form0}>
            {[0, 1].map(i => (
              <View key={i} style={styles.gapSm}>
                <Skeleton width={96} height={11} />
                <Skeleton height={48} radius={R.md} />
              </View>
            ))}
          </View>
        ) : (
          <InlineNotice
            tone="error"
            text={setupStatus === 'error' ? "Couldn't load this setup." : "This scenario isn't available right now."}
            actionLabel={onRetry ? 'Retry' : undefined}
            onAction={onRetry}
          />
        )}

        {/* Sent as `remember` on POST /sessions/start. Off means the backend
            skips memory extraction when the session ends. The whole row is the switch. */}
        <Pressable
          onPress={() => { haptic.selection(); setRemember(r => !r); }}
          accessibilityRole="switch"
          accessibilityState={{ checked: remember }}
          accessibilityLabel="Remember this session"
          accessibilityHint={rememberCopy}
          style={({ pressed }) => [styles.rememberRow, pressed ? styles.pressedRow : null]}
        >
          <GlassFill intensity={20} />
          <View style={[styles.rememberIcon, { backgroundColor: remember ? rgba(W.gold, 0.12) : rgba(W.text3, 0.1) }]}>
            <NavIcon name={remember ? 'sparkle' : 'eye-off'} color={remember ? W.gold : W.text2} />
          </View>
          <View style={styles.shrink}>
            <Txt variant="callout" weight={500}>Remember this session</Txt>
            <Txt variant="footnote" style={styles.rememberCopy}>{rememberCopy}</Txt>
          </View>
          <Toggle value={remember} onChange={setRemember} label="Remember this session" />
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        {err ? <InlineNotice tone="error" text={err} /> : null}
        {hint && !err ? <Txt variant="footnote" style={styles.hint}>{hint}</Txt> : null}
        <PrimaryButton
          accent={scenario.accent}
          haptic="medium"
          loading={busy}
          disabled={!def || !pickedVoice || missing.length > 0}
          onPress={start}
          accessibilityHint={hint ?? undefined}
        >
          Start session
        </PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S17 ACTIVE STUDIO SESSION ───────────────────────────────────────────
// Same wiring as S14_Chat: one backend text session, SSE replies, session
// ended on unmount. A studio character is just a character, so the endpoints
// match. The session opens on the first send, not on arrival, so visits that
// say nothing stop leaving empty sessions behind.
type UserMsg = { id: string; from: 'user'; text: string; status?: 'failed'; reason?: string };
type CompMsg = { id: string; from: 'comp'; text: string; turnId?: string; streaming?: boolean; cut?: 'reload' | 'reloading' | 'lost' };
type NoticeMsg = { id: string; from: 'notice'; text: string };
type CrisisMsg = { id: string; from: 'crisis'; text: string };
type SMsg = UserMsg | CompMsg | NoticeMsg | CrisisMsg;

interface PendingTurn { text: string; userId: string; replyId: string }

let msgSeq = 0;
const nextId = (prefix: string) => `${prefix}${++msgSeq}`;

function updateMsg<K extends SMsg['from']>(
  list: SMsg[], id: string, from: K, fn: (m: Extract<SMsg, { from: K }>) => SMsg,
): SMsg[] {
  return list.map(m => (m.id === id && m.from === from ? fn(m as Extract<SMsg, { from: K }>) : m));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new NetworkError('Timed out', true)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Openers for a brand-new thread, sent as the user's first line.
const STARTERS: Record<string, string[]> = {
  interview: ['Start the interview', 'Ask me a tough one first'],
  difficult: ['You start the conversation', "Let's begin"],
  debate: ['Open with your strongest argument', 'Ask me where I stand'],
  story: ['Set the opening scene', 'Surprise me'],
  language: ['Start with something simple', 'Ask me about my day'],
};
const CUSTOM_STARTERS = ['Tell me about yourself', 'What should we talk about?'];

export function S17_StudioSession({
  go, scenario, characterId, totalSessions = 0, remember: rememberProp = true, isMinor = false,
  textRemainingToday = null, textDailyCap = null, textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade,
}: {
  go: Go; scenario: Scenario; characterId?: string; totalSessions?: number; remember?: boolean;
  /** Known minors get the break reminder California requires. */
  isMinor?: boolean;
  /** Messages left today, or null while unknown. */
  textRemainingToday?: number | null;
  textDailyCap?: number | null;
  textResetsAt?: string | null;
  /** False on a paid plan: there is nothing left to sell them. */
  textUpsell?: boolean;
  onQuotaRefused?: () => void;
  onCapUpgrade?: () => void;
}) {
  const [brief] = useState(() => (characterId ? setupBriefs.get(characterId) : undefined));
  const [msgs, setMsgs] = useState<SMsg[]>([]);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  useAiNoticeRepeat(() => setMsgs(m => [...m, { id: nextId('n'), from: 'notice', text: aiNoticeText(scenario.name, isMinor, true) }]));

  const [draft, setDraft] = useState('');
  const [capRefused, setCapRefused] = useState<{ message?: string; planCap: boolean } | null>(null);
  const capHit = capRefused != null || (textRemainingToday != null && textRemainingToday <= 0);
  const [history, setHistory] = useState<LoadStatus>(characterId ? 'loading' : 'ready');
  const [remember, setRememberState] = useState(rememberProp);
  // The memory choice is sent with the session request, so it can change
  // only until then (and again if that request fails).
  const [memoryLocked, setMemoryLocked] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [hadTurn, setHadTurn] = useState(false);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [reportTurn, setReportTurn] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(false);

  const mounted = useRef(true);
  const scrollRef = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const rememberRef = useRef(rememberProp);
  const rememberTouched = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const startRef = useRef<Promise<string> | null>(null);
  const requested = useRef(false);
  const historyGate = useRef<Promise<void>>(Promise.resolve());
  const queue = useRef<PendingTurn[]>([]);
  const turnBusy = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const attempted = useRef(false);

  // What the continued conversation was set to wins over the router's
  // default, unless the user has already chosen here or the session has
  // been asked for.
  const adoptServerRemember = (v: boolean) => {
    if (rememberTouched.current || requested.current) return;
    rememberRef.current = v;
    setRememberState(v);
  };

  const changeRemember = (v: boolean) => {
    rememberTouched.current = true;
    rememberRef.current = v;
    setRememberState(v);
    announce(v ? 'This session will be remembered.' : 'One-time session. Nothing from it will be saved.');
  };

  // Resume where the user left off: the newest session that has turns.
  const loadHistory = useCallback(async (): Promise<void> => {
    if (!characterId) return;
    setHistory('loading');
    try {
      const { sessions } = await getCharacterSessions(characterId);
      // Visits used to open a session each, so many are empty. Fetch them
      // together rather than one after another.
      const turnsBySession = await Promise.all(sessions.map(s => getConversationTurns(s._id).then(r => r.turns)));
      if (!mounted.current) return;
      const idx = turnsBySession.findIndex(t => t.length > 0);
      const basis = (sessions[idx] ?? sessions[0]) as SessionWithMemory | undefined;
      if (typeof basis?.memory_enabled === 'boolean') adoptServerRemember(basis.memory_enabled);
      if (idx >= 0) {
        const earlier = turnsBySession[idx].map((t): SMsg => (t.role === 'user'
          ? { id: `h${t._id}`, from: 'user', text: t.content_text }
          : { id: `h${t._id}`, from: 'comp', text: t.content_text, turnId: t._id }));
        // Merge rather than replace: anything sent while this loaded stays, after it.
        setMsgs(m => (m.some(x => x.id.startsWith('h')) ? m : [...earlier, ...m]));
      }
      setHistory('ready');
    } catch {
      if (mounted.current) setHistory('error');
    }
    // adoptServerRemember only touches refs and a state setter.
  }, [characterId]);

  useEffect(() => {
    historyGate.current = loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;
    getMemories(characterId)
      .then(ms => { if (!cancelled) setMemoryCount(ms.length); })
      .catch(() => { /* the banner just leaves the count out */ });
    return () => { cancelled = true; };
  }, [characterId]);

  // Teardown, once, with what this visit knew at mount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      if (sessionRef.current) endSession(sessionRef.current).catch(() => {});
      // A setup started and then left without a word would otherwise sit,
      // unseen, in the 20-character Studio limit.
      if (characterId && brief?.unused && !attempted.current) {
        setupBriefs.delete(characterId);
        deleteStudioCharacter(characterId).catch(() => {});
      }
    };
  }, []);

  // ── Session ─────────────────────────────────────────────────────────
  const ensureSession = (): Promise<string> => {
    if (sessionRef.current) return Promise.resolve(sessionRef.current);
    if (!startRef.current && characterId) {
      const cid = characterId;
      const attempt = Promise.race([historyGate.current, wait(PREF_WAIT_MS)])
        .then(() => {
          requested.current = true;
          setMemoryLocked(true);
          return startSession(cid, 'text', rememberRef.current);
        })
        .then(res => {
          if (!mounted.current) {
            endSession(res.session_id).catch(() => {});
            throw new Error('Screen closed');
          }
          sessionRef.current = res.session_id;
          return res.session_id;
        });
      startRef.current = attempt;
      attempt.then(
        () => { if (startRef.current === attempt) startRef.current = null; },
        () => {
          if (startRef.current === attempt) startRef.current = null;
          // No session came of it, so the memory choice is open again.
          if (!sessionRef.current && mounted.current) {
            requested.current = false;
            setMemoryLocked(false);
          }
        },
      );
    }
    if (!startRef.current) return Promise.reject(new Error('No character'));
    // A start that outlives the timeout still lands in sessionRef for the retry.
    return withTimeout(startRef.current, SESSION_START_TIMEOUT_MS);
  };

  // Turns go out one at a time, in order; each waits for the one before.
  const pump = () => {
    if (turnBusy.current) return;
    const turn = queue.current[0];
    if (!turn) return;
    turnBusy.current = true;
    ensureSession().then(
      sid => { if (mounted.current) runTurn(sid, turn); },
      e => {
        if (!mounted.current) return;
        const failed = queue.current.splice(0);
        turnBusy.current = false;
        const replyIds = new Set(failed.map(t => t.replyId));
        const userIds = new Set(failed.map(t => t.userId));
        setMsgs(m => m
          .filter(x => !replyIds.has(x.id))
          .map((x): SMsg => (x.from === 'user' && userIds.has(x.id) ? { ...x, status: 'failed', reason: undefined } : x)));
        setSessionError(sessionStartMessage(e));
        haptic.error();
      },
    );
  };

  const finishTurn = () => {
    queue.current.shift();
    turnBusy.current = false;
    pump();
  };

  const runTurn = (sid: string, turn: PendingTurn) => {
    let received = false;
    abortRef.current = streamConversation(
      { session_id: sid, message: turn.text },
      {
        onChunk: content => {
          if (!received) {
            received = true;
            haptic.selection();
          }
          setMsgs(m => updateMsg(m, turn.replyId, 'comp', r => ({ ...r, text: r.text + content })));
        },
        onDone: turnId => {
          setHadTurn(true);
          setMsgs(m => updateMsg(m, turn.replyId, 'comp', r => ({ ...r, streaming: false, turnId: turnId || undefined })));
          if (!nearBottom.current) setUnseen(true);
          finishTurn();
        },
        // The server's safety response replaces the reply. It stays in the
        // thread with real resources, and the conversation carries on.
        onCrisis: content => {
          setHadTurn(true);
          setMsgs(m => m.map((x): SMsg => (x.id === turn.replyId ? { id: x.id, from: 'crisis', text: content } : x)));
          announce(content ? `${content} Support options follow.` : 'Support options are shown in the conversation.');
          finishTurn();
        },
        onError: (_message, info) => {
          const limited = messageLimitOf(info);
          if (limited) {
            // Same limits as the companion chat, and the same rule: give the
            // typed lines back rather than lose them. Anything queued behind
            // would be refused too, so it comes back with them.
            const refused = [turn, ...queue.current.slice(1)];
            queue.current = [];
            turnBusy.current = false;
            const ids = new Set(refused.flatMap(t => [t.userId, t.replyId]));
            setMsgs(m => m.filter(x => !ids.has(x.id)));
            setDraft(d => restoreDraft(d, refused.map(t => t.text).join('\n')));
            setCapRefused(limited);
            onQuotaRefused?.();
            haptic.warning();
            return;
          }
          haptic.error();
          if (received) {
            // Keep what arrived; the rest may be on the server.
            setMsgs(m => updateMsg(m, turn.replyId, 'comp', r => ({ ...r, streaming: false, cut: 'reload' })));
            announce('The reply was cut off.');
          } else {
            // Never put client-written text in the character's mouth: the
            // message is marked unsent instead, and keeps its text.
            setMsgs(m => updateMsg(
              m.filter(x => x.id !== turn.replyId), turn.userId, 'user',
              u => ({ ...u, status: 'failed', reason: notSentReason(info) }),
            ));
            announce('Message not sent.');
          }
          finishTurn();
        },
      },
    );
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text || !characterId) return;
    attempted.current = true;
    if (brief) brief.unused = false;
    // A new attempt clears the last refusal — the cap resets at midnight.
    setCapRefused(null);
    setSessionError(null);
    const turn: PendingTurn = { text, userId: nextId('u'), replyId: nextId('r') };
    setMsgs(m => [...m, { id: turn.userId, from: 'user', text }, { id: turn.replyId, from: 'comp', text: '', streaming: true }]);
    // Your own message always scrolls into view.
    nearBottom.current = true;
    setUnseen(false);
    queue.current.push(turn);
    pump();
  };

  const send = () => {
    if (!draft.trim()) return;
    haptic.medium();
    submit(draft);
    setDraft('');
  };

  // Retrying moves the message to the end, as iMessage does.
  const retry = (id: string) => {
    const m = msgsRef.current.find(x => x.id === id);
    if (!m || m.from !== 'user') return;
    haptic.light();
    setMsgs(ms => ms.filter(x => x.id !== id));
    submit(m.text);
  };

  const retryAllFailed = () => {
    const failed = msgsRef.current.filter((x): x is UserMsg => x.from === 'user' && x.status === 'failed');
    setSessionError(null);
    if (!failed.length) return;
    const ids = new Set(failed.map(f => f.id));
    setMsgs(ms => ms.filter(x => !ids.has(x.id)));
    failed.forEach(f => submit(f.text));
  };

  // A reply cut off mid-stream may have finished on the server.
  const reload = async (replyId: string) => {
    const sid = sessionRef.current;
    if (!sid) return;
    setMsgs(m => updateMsg(m, replyId, 'comp', r => ({ ...r, cut: 'reloading' })));
    try {
      const { turns } = await getConversationTurns(sid);
      if (!mounted.current) return;
      const known = new Set(msgsRef.current.map(x => (x.from === 'comp' ? x.turnId : undefined)).filter(Boolean));
      const latest = [...turns].reverse().find(t => t.role === 'assistant' && !known.has(t._id));
      if (latest) {
        setHadTurn(true);
        setMsgs(m => updateMsg(m, replyId, 'comp', r => ({ ...r, text: latest.content_text, turnId: latest._id, cut: undefined })));
        announce('Reply restored.');
      } else {
        setMsgs(m => updateMsg(m, replyId, 'comp', r => ({ ...r, cut: 'lost' })));
        announce("That reply didn't finish.");
      }
    } catch {
      if (!mounted.current) return;
      setMsgs(m => updateMsg(m, replyId, 'comp', r => ({ ...r, cut: 'reload' })));
      announce("Couldn't reload. Try again.");
    }
  };

  const openReport = (turnId: string) => {
    haptic.medium();
    Keyboard.dismiss();
    setReportTurn(turnId);
  };

  const openSummary = () => {
    haptic.light();
    Keyboard.dismiss();
    setShowSummary(true);
  };

  // ── Scrolling ───────────────────────────────────────────────────────
  // Pinned to the end while the user is there; reading further up is left
  // alone, and a chip offers the way back when something new arrives.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
    nearBottom.current = near;
    if (near) setUnseen(false);
  };
  const onContentSizeChange = () => {
    if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
  };
  const jumpToEnd = () => {
    nearBottom.current = true;
    setUnseen(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };
  const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
  useEffect(() => {
    const last = msgsRef.current[msgsRef.current.length - 1];
    if (last && !nearBottom.current && (last.from === 'comp' || last.from === 'crisis')) setUnseen(true);
  }, [lastId]);

  const talked = msgs.some(m => m.from === 'user' || m.from === 'comp' || m.from === 'crisis');
  const showOpener = history === 'ready' && !talked;
  const sessionN = totalSessions + 1;

  const renderMsg = (m: SMsg) => {
    switch (m.from) {
      case 'notice':
        return <AiNotice key={m.id} text={m.text} />;
      case 'crisis':
        return <CrisisCard key={m.id} content={m.text} onMore={() => go('crisis')} />;
      case 'user':
        return (
          <View key={m.id}>
            <BubbleMem from="user" text={m.text} />
            {m.status === 'failed' ? <FailedNote reason={m.reason} onPress={() => retry(m.id)} /> : null}
          </View>
        );
      case 'comp':
        if (m.streaming && !m.text) {
          return (
            <View key={m.id} accessible accessibilityLabel={`${scenario.name} is replying`}>
              <TypingDots />
            </View>
          );
        }
        return (
          <View key={m.id}>
            <View
              accessible
              accessibilityLabel={`${scenario.name}: ${m.text}`}
              accessibilityActions={m.turnId ? REPORT_ACTIONS : undefined}
              onAccessibilityAction={m.turnId ? () => openReport(m.turnId!) : undefined}
            >
              <BubbleMem
                from="comp"
                text={m.text}
                accent={scenario.accent}
                streaming={m.streaming}
                // App Store Guideline 1.2: generated replies must be reportable.
                onLongPress={m.turnId ? () => openReport(m.turnId!) : undefined}
              />
            </View>
            {m.cut ? <CutNote state={m.cut} onReload={() => reload(m.id)} /> : null}
          </View>
        );
    }
  };

  return (
    <Screen>
      <TopBar
        left={<BackButton onPress={() => go('studio')} />}
        title={scenario.name}
        focusTitleOnMount
        right={<EndButton onPress={openSummary} />}
        glass
        border
      />
      <MemoryBanner
        remember={remember}
        sessionN={sessionN}
        memoryCount={memoryCount}
        changeable={!memoryLocked}
        accent={scenario.accent}
        onChange={changeRemember}
      />
      <View style={styles.flex1}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex1}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          scrollEventThrottle={32}
          onContentSizeChange={onContentSizeChange}
        >
          <AiNotice text={aiNoticeText(scenario.name, isMinor, false)} />
          {history === 'loading' && !talked ? <ThreadSkeleton /> : null}
          {history === 'error' ? (
            <InlineNotice
              tone="warning"
              text="Couldn't load your earlier messages."
              actionLabel="Retry"
              onAction={() => { historyGate.current = loadHistory(); }}
            />
          ) : null}
          {showOpener ? (
            <SessionOpener scenario={scenario} characterId={characterId} lines={brief?.lines ?? []} onStarter={submit} />
          ) : null}
          {msgs.map(renderMsg)}
          {sessionError ? <InlineNotice tone="error" text={sessionError} actionLabel="Retry" onAction={retryAllFailed} /> : null}
          {capHit ? (
            <CapHitCard
              onUpgrade={() => { onCapUpgrade?.(); go('paywall'); }}
              dailyCap={textDailyCap}
              resetsAt={textResetsAt}
              upsell={textUpsell && (capRefused?.planCap ?? true)}
              message={capRefused?.message ?? null}
            />
          ) : null}
        </ScrollView>
        {unseen ? <NewMessageChip onPress={jumpToEnd} /> : null}
      </View>
      <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={scenario.name} />

      <SessionSummarySheet
        visible={showSummary}
        name={scenario.name}
        sessionN={sessionN}
        characterId={characterId}
        remember={remember}
        hadTurn={hadTurn}
        onForgotten={() => setMemoryCount(c => (c == null ? c : Math.max(0, c - 1)))}
        onKeepGoing={() => setShowSummary(false)}
        onEnd={() => { setShowSummary(false); go('studio'); }}
      />
      <ReportReplySheet turnId={reportTurn} onClose={() => setReportTurn(null)} />
    </Screen>
  );
}

function EndButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={minTarget(52, 30)}
      accessibilityRole="button"
      accessibilityLabel="End session"
      style={({ pressed }) => [styles.endButton, pressed ? styles.pressed : null]}
    >
      <Txt variant="subhead" weight={600} maxScale={1.3} style={{ color: W.dangerText }}>End</Txt>
    </Pressable>
  );
}

/** Session number and memory state. Before the session opens (on the first
 *  message) the whole banner is the switch; after, it only reports. */
function MemoryBanner({ remember, sessionN, memoryCount, changeable, accent, onChange }: {
  remember: boolean; sessionN: number; memoryCount: number | null; changeable: boolean; accent: string;
  onChange: (v: boolean) => void;
}) {
  const saved = memoryCount ? ` · ${memoryCount} saved` : '';
  const text = remember ? `Session ${sessionN} · Memory on${saved}` : 'One-time session · not saved';
  const spoken = remember
    ? `Session ${sessionN}. Memory is on for this session.${memoryCount ? ` ${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'} saved.` : ''}`
    : 'One-time session. Nothing from it is saved.';
  const frame = [styles.banner, { borderColor: rgba(accent, 0.12), borderLeftColor: accent }];
  const body = (
    <>
      <GlassFill intensity={20} />
      <NavIcon name={remember ? 'sparkle' : 'eye-off'} color={remember ? W.gold : W.text2} size={14} />
      <Txt variant="footnote" numberOfLines={2} style={[styles.shrinkText, { color: remember ? W.gold : W.text2 }]}>{text}</Txt>
      {changeable ? <Toggle value={remember} onChange={onChange} label="Remember this session" /> : null}
    </>
  );
  if (!changeable) {
    return <View accessible accessibilityLabel={spoken} style={frame}>{body}</View>;
  }
  return (
    <Pressable
      onPress={() => { haptic.selection(); onChange(!remember); }}
      accessibilityRole="switch"
      accessibilityLabel="Remember this session"
      accessibilityState={{ checked: remember }}
      accessibilityHint={spoken}
      style={({ pressed }) => [frame, pressed ? styles.pressedRow : null]}
    >
      {body}
    </Pressable>
  );
}

function ThreadSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading the conversation" style={styles.threadSkeleton}>
      <Skeleton width="62%" height={44} radius={R.bubble} />
      <Skeleton width="44%" height={44} radius={R.bubble} style={styles.alignEnd} />
      <Skeleton width="70%" height={44} radius={R.bubble} />
    </View>
  );
}

/** The first thing in a new thread: what this is, how it was set up, and a
 *  few ways to begin. */
function SessionOpener({ scenario, characterId, lines, onStarter }: {
  scenario: Scenario; characterId?: string; lines: { label: string; value: string }[]; onStarter: (text: string) => void;
}) {
  const entering = useOnce(() => enter.fadeUp);
  const exiting = useOnce(() => exit.fade);
  const custom = !STARTERS[scenario.id];
  const starters = STARTERS[scenario.id] ?? CUSTOM_STARTERS;
  return (
    <Animated.View entering={entering} exiting={exiting} style={styles.opener}>
      <GlassFill intensity={20} />
      <View style={styles.rowCenter}>
        {custom && characterId
          ? <Avatar name={scenario.name} glyph="initials" color={avatarColor(characterId)} size={32} breathe={false} />
          : <IconTile icon={scenario.icon} accent={scenario.accent} size={32} />}
        <Txt variant="headline" heading numberOfLines={2} style={styles.shrinkText}>{scenario.name}</Txt>
      </View>
      {scenario.desc ? <Txt variant="subhead" style={{ color: W.text2 }}>{scenario.desc}</Txt> : null}
      {lines.length ? (
        <View style={styles.gapXs}>
          {lines.map(l => (
            <Txt key={l.label} variant="footnote" style={{ color: W.text2 }}>
              <Txt variant="footnote" weight={600} style={{ color: W.text }}>
                {/[?:]$/.test(l.label) ? `${l.label} ` : `${l.label}: `}
              </Txt>
              {l.value}
            </Txt>
          ))}
        </View>
      ) : null}
      <Txt variant="footnote" style={{ color: W.text3 }}>
        {custom ? `Say hello to ${scenario.name}, or start with one of these:` : 'Say hello, or start with one of these:'}
      </Txt>
      <View style={styles.starters}>
        {starters.map(s => <QuickReply key={s} onPress={() => onStarter(s)}>{s}</QuickReply>)}
      </View>
    </Animated.View>
  );
}

function FailedNote({ reason, onPress }: { reason?: string; onPress: () => void }) {
  const entering = useOnce(() => enter.fade);
  return (
    <Animated.View entering={entering} style={styles.alignEnd}>
      <Pressable
        onPress={onPress}
        hitSlop={minTarget(HIT, 24)}
        accessibilityRole="button"
        accessibilityLabel={reason ? `Message not sent. ${reason}` : 'Message not sent'}
        accessibilityHint="Sends it again"
        style={({ pressed }) => [styles.turnNote, pressed ? styles.pressed : null]}
      >
        <NavIcon name="refresh" color={W.dangerText} size={14} />
        <Txt variant="footnote" style={{ color: W.dangerText, flexShrink: 1 }}>
          {reason ? `Not sent. ${reason} Tap to retry.` : 'Not sent. Tap to retry.'}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

function CutNote({ state, onReload }: { state: 'reload' | 'reloading' | 'lost'; onReload: () => void }) {
  if (state === 'lost') {
    return <Txt variant="footnote" style={styles.cutText}>This reply didn't finish.</Txt>;
  }
  if (state === 'reloading') {
    return <Txt variant="footnote" style={styles.cutText}>Reloading…</Txt>;
  }
  return (
    <Pressable
      onPress={onReload}
      hitSlop={minTarget(HIT, 24)}
      accessibilityRole="button"
      accessibilityLabel="Connection dropped. Reload the reply"
      style={({ pressed }) => [styles.turnNote, styles.alignStart, pressed ? styles.pressed : null]}
    >
      <NavIcon name="refresh" color={W.warning} size={14} />
      <Txt variant="footnote" style={{ color: W.warning }}>Connection dropped · Reload</Txt>
    </Pressable>
  );
}

function NewMessageChip({ onPress }: { onPress: () => void }) {
  const entering = useOnce(() => enter.fadeUp);
  const exiting = useOnce(() => exit.fade);
  return (
    <Animated.View entering={entering} exiting={exiting} pointerEvents="box-none" style={styles.chipWrap}>
      <Pressable
        onPress={onPress}
        hitSlop={minTarget(132, 34)}
        accessibilityRole="button"
        accessibilityLabel="Jump to the new message"
        style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
      >
        <GlassFill intensity={30} />
        <NavIcon name="down" color={W.text} size={14} />
        <Txt variant="footnote" weight={600} maxScale={1.3}>New message</Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── Crisis support, inline ──────────────────────────────────────────────
// Where the reply would have been: the server's own words, then help that
// works where the phone is (data/crisis.ts), then the full resources screen.
function CrisisCard({ content, onMore }: { content: string; onMore: () => void }) {
  const [{ emergency, resources }] = useState(() => crisisResources());
  const [failedId, setFailedId] = useState<string | null>(null);
  const entering = useOnce(() => enter.fadeUp);

  const open = async (r: CrisisResource) => {
    const ok = await openCrisisResource(r);
    setFailedId(ok ? null : r.id);
    if (!ok) announce(`Couldn't open that on this phone. ${r.detail}.`);
  };

  return (
    <Animated.View entering={entering} style={styles.crisis}>
      {content ? <Txt variant="bodyComp">{content}</Txt> : null}
      <View style={styles.rowCenter}>
        <View style={styles.crisisIcon}>
          <NavIcon name="heart" color={W.gold} size={18} />
        </View>
        <Txt variant="headline" heading style={styles.shrinkText}>Talk to someone now</Txt>
      </View>
      <View style={styles.gapSm}>
        {[emergency, ...resources].map(r => (
          <CrisisRow key={r.id} resource={r} failed={failedId === r.id} onOpen={() => open(r)} />
        ))}
      </View>
      <Pressable
        onPress={onMore}
        hitSlop={minTarget(120, 28)}
        accessibilityRole="button"
        accessibilityLabel="More support"
        style={({ pressed }) => [styles.crisisMore, pressed ? styles.pressed : null]}
      >
        <Txt variant="subhead" weight={600} style={{ color: W.gold }}>More support</Txt>
        <NavIcon name="right" color={W.gold} size={16} />
      </Pressable>
    </Animated.View>
  );
}

function CrisisRow({ resource: r, failed, onOpen }: { resource: CrisisResource; failed: boolean; onOpen: () => void }) {
  const openable = canOpenCrisisResource(r);
  const icon: IconName = r.kind === 'call' ? 'phone' : r.kind === 'text' ? 'chat' : 'globe';
  const label = [r.name, r.detail, r.hours].filter(Boolean).join('. ');
  const body = (
    <>
      <View style={styles.crisisRowIcon}>
        <NavIcon name={icon} color={W.gold} size={16} />
      </View>
      <View style={styles.shrink}>
        <Txt variant="subhead" weight={600}>{r.name}</Txt>
        <Txt variant="footnote" style={{ color: W.text2 }}>{r.hours ? `${r.detail} · ${r.hours}` : r.detail}</Txt>
        {failed ? (
          <Txt variant="footnote" style={{ color: W.dangerText }}>Couldn't open this on your phone. Use the details above.</Txt>
        ) : null}
      </View>
      {openable ? <NavIcon name="right" color={W.text2} size={16} /> : null}
    </>
  );
  // Nothing to dial (no local number known): shown as text, not a button.
  if (!openable) return <View accessible accessibilityLabel={label} style={styles.crisisRow}>{body}</View>;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole={r.kind === 'web' ? 'link' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={r.kind === 'call' ? 'Calls this number' : r.kind === 'text' ? 'Opens Messages' : 'Opens in your browser'}
      style={({ pressed }) => [styles.crisisRow, pressed ? styles.pressedRow : null]}
    >
      {body}
    </Pressable>
  );
}

// ─── Session summary sheet ───────────────────────────────────────────────
// What is real is the character's memory set — shown here, and forgettable
// with a short undo. Memories from this session are written by a job that runs
// after it ends, so this can only list what was already remembered.
function SessionSummarySheet({ visible, name, sessionN, characterId, remember, hadTurn, onForgotten, onKeepGoing, onEnd }: {
  visible: boolean; name: string; sessionN: number; characterId?: string; remember: boolean; hadTurn: boolean;
  onForgotten: () => void; onKeepGoing: () => void; onEnd: () => void;
}) {
  const screenReader = useScreenReader();
  const [state, setState] = useState<LoadStatus>('loading');
  const [memories, setMemories] = useState<ApiMemory[]>([]);
  const [pending, setPending] = useState<ApiMemory | null>(null);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const pendingRef = useRef<{ memory: ApiMemory; index: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(() => {
    const id = ++request.current;
    setForgetError(null);
    if (!characterId) {
      setMemories([]);
      setState('ready');
      return;
    }
    setState('loading');
    getMemories(characterId).then(
      ms => {
        if (request.current !== id || !mounted.current) return;
        // One waiting on its undo is still on the server; keep it hidden.
        setMemories(ms.filter(m => m._id !== pendingRef.current?.memory._id));
        setState('ready');
      },
      () => { if (request.current === id && mounted.current) setState('error'); },
    );
  }, [characterId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const putBack = (p: { memory: ApiMemory; index: number }) => setMemories(ms => {
    const out = [...ms];
    out.splice(Math.min(p.index, out.length), 0, p.memory);
    return out;
  });

  const commit = () => {
    clearTimeout(timer.current);
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    deleteMemory(p.memory._id).then(
      () => { if (mounted.current) onForgotten(); },
      () => {
        if (!mounted.current) return;
        putBack(p);
        haptic.error();
        setForgetError("Couldn't forget that memory, so it's back in the list.");
      },
    );
  };

  // Leaving before the undo runs out still forgets it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      const p = pendingRef.current;
      if (p) deleteMemory(p.memory._id).catch(() => {});
    };
  }, []);

  const forget = (m: ApiMemory) => {
    commit();
    haptic.light();
    const index = memories.findIndex(x => x._id === m._id);
    pendingRef.current = { memory: m, index };
    setPending(m);
    setForgetError(null);
    setMemories(ms => ms.filter(x => x._id !== m._id));
    timer.current = setTimeout(commit, screenReader ? UNDO_MS_SCREEN_READER : UNDO_MS);
    announce('Memory forgotten. You can undo this for a few seconds.');
  };

  const undo = () => {
    clearTimeout(timer.current);
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    putBack(p);
    announce('Memory restored.');
  };

  return (
    <Sheet
      visible={visible}
      onClose={onKeepGoing}
      title="Session summary"
      footer={
        <>
          <PrimaryButton onPress={onEnd} haptic="light">End session</PrimaryButton>
          <PrimaryButton variant="secondary" onPress={onKeepGoing} haptic={false}>Keep going</PrimaryButton>
        </>
      }
    >
      <View style={styles.gapMd}>
        <Txt variant="subhead" numberOfLines={2} style={{ color: W.text2 }}>Session {sessionN} · {name}</Txt>
        {!remember ? <InlineNotice tone="info" text="This was a one-time session. Nothing from it is saved." /> : null}

        <View style={styles.rowTight}>
          <NavIcon name="sparkle" color={W.gold} size={14} />
          <Txt variant="eyebrow" heading style={{ color: W.gold }}>Already remembered</Txt>
        </View>
        {remember && hadTurn ? (
          <Txt variant="footnote" style={{ color: W.text3 }}>New memories from this session appear a minute or so after it ends.</Txt>
        ) : null}

        {pending ? <InlineNotice tone="info" text="Memory forgotten." actionLabel="Undo" onAction={undo} /> : null}
        {forgetError ? <InlineNotice tone="error" text={forgetError} /> : null}

        {state === 'loading' ? (
          <View accessible accessibilityLabel="Loading memories" style={styles.gapSm}>
            {[0, 1, 2].map(i => <Skeleton key={i} height={44} radius={R.md} />)}
          </View>
        ) : state === 'error' ? (
          <InlineNotice tone="error" text="Couldn't load memories." actionLabel="Retry" onAction={load} />
        ) : memories.length === 0 && !pending ? (
          <Txt variant="subhead" style={{ color: W.text2 }}>Nothing remembered from {name} yet.</Txt>
        ) : (
          <View style={styles.gapSm}>
            {memories.map(m => (
              <Animated.View key={m._id} layout={layout} style={styles.memoryRow}>
                <Txt variant="callout" style={styles.shrinkText}>{m.content}</Txt>
                <IconButton icon="close" label="Forget this memory" onPress={() => forget(m)} size={32} iconSize={16} tint={W.text2} haptic={false} />
              </Animated.View>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

// ─── Report sheet ────────────────────────────────────────────────────────
// Apple Guideline 1.2 — users must be able to report AI-generated content.
const REPORT_REASONS: { k: ReportReason; l: string }[] = [
  { k: 'harmful', l: 'Harmful or unsafe' },
  { k: 'sexual', l: 'Sexual content' },
  { k: 'inappropriate_minor', l: 'Inappropriate for a minor' },
  { k: 'inaccurate', l: 'Inaccurate' },
  { k: 'other', l: 'Something else' },
];

function ReportReplySheet({ turnId, onClose }: { turnId: string | null; onClose: () => void }) {
  // Kept after close so the content doesn't vanish while the sheet slides out.
  const [target, setTarget] = useState(turnId);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!turnId) return;
    setTarget(turnId);
    setReason(null);
    setNote('');
    setState('idle');
  }, [turnId]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const submit = async () => {
    if (!target || !reason || state === 'sending') return;
    setState('sending');
    try {
      await createReport(target, reason, note.trim() || undefined);
      setState('sent');
      haptic.success();
      announce('Report sent. Thank you.');
      closeTimer.current = setTimeout(onClose, 1400);
    } catch {
      setState('failed');
      haptic.error();
    }
  };

  const sent = state === 'sent';
  return (
    <Sheet
      visible={turnId != null}
      onClose={onClose}
      title={sent ? 'Thanks for telling us' : 'Report this reply'}
      footer={sent ? undefined : (
        <PrimaryButton disabled={!reason} loading={state === 'sending'} onPress={submit}>Submit report</PrimaryButton>
      )}
    >
      {sent ? (
        <Txt variant="body" style={{ color: W.text2 }}>We'll review it. Reports help keep Evarna safe.</Txt>
      ) : (
        <View style={styles.gapMd}>
          <Txt variant="subhead" style={{ color: W.text2 }}>What was wrong with it?</Txt>
          <View accessibilityRole="radiogroup" accessibilityLabel="Reason" style={styles.gapSm}>
            {REPORT_REASONS.map(r => (
              <Pill key={r.k} size="sm" selected={reason === r.k} onPress={() => setReason(r.k)}>{r.l}</Pill>
            ))}
          </View>
          <Field
            multiline
            value={note}
            onChangeText={setNote}
            maxLength={REPORT_NOTE_MAX}
            placeholder="Add a note (optional)"
            accessibilityLabel="Note, optional"
            textAlignVertical="top"
            style={styles.noteInput}
          />
          {state === 'failed' ? (
            <InlineNotice tone="error" text="Couldn't send the report. Check your connection and try again." />
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

// ─── S18 CHARACTER CREATOR ───────────────────────────────────────────────
const SLIDERS = [
  { k: 'warmth', l: 'Warmth', left: '❄️', right: '☀️', low: 'Cool', high: 'Warm' },
  { k: 'humor', l: 'Humor', left: '😐', right: '😂', low: 'Serious', high: 'Playful' },
  { k: 'directness', l: 'Directness', left: '🌊', right: '🎯', low: 'Gentle', high: 'Direct' },
  { k: 'energy', l: 'Energy', left: '🌙', right: '⚡', low: 'Calm', high: 'Lively' },
  { k: 'formality', l: 'Formality', left: '👕', right: '👔', low: 'Casual', high: 'Formal' },
] as const;
type TraitSpec = (typeof SLIDERS)[number];
type TraitKey = TraitSpec['k'];

const traitWord = (s: TraitSpec, v: number) => (v < 0.34 ? s.low : v > 0.66 ? s.high : 'Balanced');

const STEP_TITLES = ['', 'The basics', 'Personality', 'Backstory', 'Review'];
const STEPS = 4;

export function S18_CharacterCreator({ go, apiVoices = [], voicesStatus, onRetryVoices }: {
  go: Go;
  apiVoices?: ApiVoice[];
  voicesStatus?: LoadStatus;
  onRetryVoices?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<1 | -1>(1);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<StudioGender>('female');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [traits, setTraits] = useState<Record<TraitKey, number>>({ warmth: 0.6, humor: 0.5, directness: 0.5, energy: 0.4, formality: 0.3 });
  const [backstory, setBackstory] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const voiceStatus = useLoadStatus(apiVoices.length > 0, voicesStatus);
  useEffect(() => {
    if (apiVoices.length === 0 && voicesStatus === 'error') onRetryVoices?.();
    // Mount only: later failures are the Retry button's job.
  }, []);

  const voiceList = voicesFor(apiVoices, gender);
  const pickedVoice = voiceList.some(v => v.id === voiceId) ? voiceId : voiceList[0]?.id ?? null;
  const voiceName = apiVoices.find(v => v.id === pickedVoice)?.name;
  const trimmed = name.trim();
  const canNext = !!trimmed && !!pickedVoice;
  const stepHint = step === 1 && !canNext ? (!trimmed ? 'Add a name to continue.' : 'Pick a voice to continue.') : null;

  const goStep = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
    setErr(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    announce(`Step ${n} of ${STEPS}. ${STEP_TITLES[n]}.`);
  };

  const back = () => {
    if (step > 1) return goStep(step - 1);
    if (!trimmed && !backstory.trim()) return go('studio');
    confirmDestructive({
      title: 'Discard this character?',
      message: "What you've set up so far won't be saved.",
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      onConfirm: () => go('studio'),
    });
  };

  const create = async () => {
    if (!pickedVoice || !trimmed || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await createStudioCharacter({
        kind: 'custom',
        name: trimmed,
        ...(backstory.trim() ? { backstory: backstory.trim() } : {}),
        voice_id: pickedVoice,
        gender: API_GENDER[gender],
        // Sliders are 0–1 floats here, 0–100 integers on the backend.
        personality_sliders: Object.fromEntries(
          Object.entries(traits).map(([k, v]) => [k, Math.round(v * 100)]),
        ),
      });
      const created = res.name || trimmed;
      justCreated = { _id: res.character_id, name: created, gender: API_GENDER[gender], voice_id: pickedVoice, kind: 'custom' };
      haptic.success();
      announce(`${created} is ready. You'll find them under Your characters.`);
      go('studio');
    } catch (e) {
      haptic.error();
      setErr(createErrorMessage(e));
      setBusy(false);
    }
  };

  const personality = SLIDERS.map(s => traitWord(s, traits[s.k])).filter(w => w !== 'Balanced');

  return (
    <Screen>
      <TopBar
        left={<BackButton onPress={back} />}
        center={
          <View style={styles.stepTitle}>
            <Txt variant="subhead" weight={600} heading numberOfLines={1}>{STEP_TITLES[step]}</Txt>
            <ProgressDots total={STEPS} current={step} />
          </View>
        }
      />
      <ScrollView
        ref={scrollRef}
        style={styles.flex1}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <StepPane key={step} dir={dir}>
          {step === 1 ? (
            <>
              <View>
                <FieldLabel>Name</FieldLabel>
                <Field
                  value={name}
                  onChangeText={setName}
                  placeholder="Marcus"
                  maxLength={NAME_MAX}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => { if (canNext) goStep(2); }}
                  accessibilityLabel="Name"
                  style={styles.nameInput}
                />
              </View>
              <View>
                <FieldLabel>Voice gender</FieldLabel>
                <GenderPills value={gender} onChange={setGender} />
              </View>
              <View>
                <FieldLabel>Voice</FieldLabel>
                <VoicePicker
                  voices={voiceList} catalogSize={apiVoices.length} gender={gender} voiceId={pickedVoice} onPick={setVoiceId}
                  status={voiceStatus} onRetry={onRetryVoices}
                />
              </View>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Txt variant="subhead" style={{ color: W.text2 }}>How should {trimmed} come across?</Txt>
              {SLIDERS.map(s => (
                <TraitSlider key={s.k} spec={s} value={traits[s.k]} onChange={v => setTraits(t => ({ ...t, [s.k]: v }))} />
              ))}
            </>
          ) : null}

          {step === 3 ? (
            <View>
              <FieldLabel note="Optional">Backstory</FieldLabel>
              <Txt variant="subhead" style={styles.fieldHelp}>A few lines on who they are and how they talk.</Txt>
              <Field
                multiline
                value={backstory}
                onChangeText={setBackstory}
                maxLength={BACKSTORY_MAX}
                placeholder="A laid-back surfer who gives surprisingly deep life advice…"
                accessibilityLabel="Backstory, optional"
                textAlignVertical="top"
                style={styles.backstory}
              />
              <Txt
                variant="caption"
                accessibilityLabel={`${backstory.length} of ${BACKSTORY_MAX} characters`}
                style={[styles.counter, { color: backstory.length >= BACKSTORY_MAX ? W.warning : W.text2 }]}
              >
                {backstory.length}/{BACKSTORY_MAX}
              </Txt>
            </View>
          ) : null}

          {/* A summary of what will be created, not a preview: a real one would
              need the character to exist before the user commits to it. */}
          {step === 4 ? (
            <>
              <View style={styles.review}>
                <ReviewRow label="Name" value={trimmed} onEdit={() => goStep(1)} />
                <ReviewRow label="Voice" value={voiceName ? `${voiceName} · ${GENDER_LABEL[gender]}` : GENDER_LABEL[gender]} onEdit={() => goStep(1)} />
                <ReviewRow
                  label="Personality"
                  value={personality.length ? personality.join(', ') : 'Balanced on every trait'}
                  onEdit={() => goStep(2)}
                />
                <ReviewRow label="Backstory" value={backstory.trim() || 'None'} muted={!backstory.trim()} onEdit={() => goStep(3)} last />
              </View>
              <Txt variant="footnote" style={{ color: W.text3 }}>
                Characters can't be edited once they're created, so check the details.
              </Txt>
            </>
          ) : null}
        </StepPane>
      </ScrollView>

      <View style={styles.footer}>
        {err ? <InlineNotice tone="error" text={err} /> : null}
        {stepHint ? <Txt variant="footnote" style={styles.hint}>{stepHint}</Txt> : null}
        {step < STEPS ? (
          <PrimaryButton haptic="selection" disabled={step === 1 && !canNext} onPress={() => goStep(step + 1)} accessibilityHint={stepHint ?? undefined}>
            Next
          </PrimaryButton>
        ) : (
          <PrimaryButton loading={busy} disabled={!canNext} onPress={create}>{`Create ${trimmed}`}</PrimaryButton>
        )}
      </View>
    </Screen>
  );
}

function StepPane({ dir, children }: { dir: 1 | -1; children: React.ReactNode }) {
  const entering = useOnce(() => (dir > 0 ? enter.fadeUp : enter.fadeDown));
  const exiting = useOnce(() => exit.fade);
  return <Animated.View entering={entering} exiting={exiting} style={styles.form0}>{children}</Animated.View>;
}

function ReviewRow({ label, value, muted = false, onEdit, last = false }: {
  label: string; value: string; muted?: boolean; onEdit: () => void; last?: boolean;
}) {
  return (
    <View style={[styles.reviewRow, last ? null : styles.reviewDivider]}>
      <View style={styles.shrink}>
        <Txt variant="eyebrow" style={{ color: W.text2 }}>{label}</Txt>
        <Txt variant="callout" style={{ color: muted ? W.text3 : W.text, marginTop: SP.xxs }}>{value}</Txt>
      </View>
      <Pressable
        onPress={onEdit}
        hitSlop={minTarget(40, 28)}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label.toLowerCase()}`}
        style={({ pressed }) => [styles.editButton, pressed ? styles.pressed : null]}
      >
        <Txt variant="subhead" weight={600} style={{ color: W.primarySoft }}>Edit</Txt>
      </Pressable>
    </View>
  );
}

// ─── Trait slider ────────────────────────────────────────────────────────
// A 44pt touch row around a 4pt track. The drag runs on the UI thread and
// commits on release; a drag that starts vertical is left to the scroll view.
// Grabbing the thumb moves it from where it is, touching the track elsewhere
// jumps there, and every tenth ticks. VoiceOver adjusts it in steps of 10.
const THUMB = 24;

function TraitSlider({ spec, value, onChange }: { spec: TraitSpec; value: number; onChange: (v: number) => void }) {
  const [shown, setShown] = useState(Math.round(value * 100));
  const width = useSharedValue(0);
  const pos = useSharedValue(value);
  const grab = useSharedValue(0);
  const held = useSharedValue(0);
  const lastPct = useSharedValue(Math.round(value * 100));
  const lastTick = useSharedValue(Math.round(value * 10));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The value this slider last handed up. When it comes back as the prop,
  // the thumb is already there (or gliding there), so leave it alone.
  const selfSet = useRef<number | null>(null);

  useEffect(() => {
    const mine = selfSet.current === value;
    selfSet.current = null;
    if (!mine) pos.value = value;
    lastPct.value = Math.round(value * 100);
    lastTick.value = Math.round(value * 10);
    setShown(Math.round(value * 100));
  }, [value, pos, lastPct, lastTick]);

  const commit = useCallback((v: number) => {
    const rounded = Math.round(v * 100) / 100;
    selfSet.current = rounded;
    onChangeRef.current(rounded);
  }, []);
  const tick = useCallback(() => haptic.selection(), []);

  const gesture = useMemo(() => {
    const valueAt = (x: number) => {
      'worklet';
      const track = width.value - THUMB;
      return track > 0 ? Math.min(1, Math.max(0, (x - THUMB / 2) / track)) : pos.value;
    };
    const report = (v: number) => {
      'worklet';
      const pct = Math.round(v * 100);
      if (pct !== lastPct.value) {
        lastPct.value = pct;
        scheduleOnRN(setShown, pct);
      }
      const step = Math.round(v * 10);
      if (step !== lastTick.value) {
        lastTick.value = step;
        scheduleOnRN(tick);
      }
    };
    const pan = Gesture.Pan()
      .activeOffsetX([-4, 4])
      .failOffsetY([-10, 10])
      .onBegin(e => {
        const thumbCentre = pos.value * (width.value - THUMB) + THUMB / 2;
        grab.value = Math.abs(e.x - thumbCentre) <= THUMB ? e.x - thumbCentre : 0;
      })
      // Swell only once the drag is really horizontal, not on a scroll's touch-down.
      .onStart(() => { held.value = withTiming(1, calm(D.instant)); })
      .onUpdate(e => {
        const v = valueAt(e.x - grab.value);
        pos.value = v;
        report(v);
      })
      .onEnd(() => { scheduleOnRN(commit, pos.value); })
      .onFinalize(() => { held.value = withTiming(0, calm(D.fast)); });
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((e, success) => {
        if (!success) return;
        const v = valueAt(e.x);
        pos.value = withTiming(v, timing(D.fast, 'decel'));
        report(v);
        scheduleOnRN(commit, v);
      });
    return Gesture.Exclusive(pan, tap);
  }, [commit, tick, width, pos, grab, held, lastPct, lastTick]);

  const fillStyle = useAnimatedStyle(() => ({ width: pos.value * Math.max(0, width.value - THUMB) }));
  const thumbStyle = useAnimatedStyle(() => ({
    // Hidden until measured, so it never flashes at the left edge.
    opacity: width.value > 0 ? 1 : 0,
    transform: [{ translateX: pos.value * Math.max(0, width.value - THUMB) }, { scale: 1 + held.value * 0.12 }],
  }));

  const adjust = (delta: number) => {
    const v = Math.min(1, Math.max(0, Math.round((value + delta) * 10) / 10));
    if (v !== value) onChange(v);
  };

  const word = traitWord(spec, shown / 100);
  return (
    <View>
      <View style={styles.traitHead}>
        <Txt variant="subhead" weight={600}>{spec.l}</Txt>
        <Txt variant="footnote" style={styles.traitValue}>{word} · {shown}</Txt>
      </View>
      <View style={styles.traitRow}>
        <Txt accessibilityElementsHidden importantForAccessibility="no" maxScale={1.2} style={styles.traitEnd}>{spec.left}</Txt>
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${spec.l}, ${spec.low} to ${spec.high}`}
            accessibilityValue={{ min: 0, max: 100, now: shown, text: `${shown}, ${word.toLowerCase()}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={e => adjust(e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)}
            onLayout={e => { width.value = e.nativeEvent.layout.width; }}
            style={styles.sliderHit}
          >
            <View pointerEvents="none" style={styles.track}>
              <Animated.View style={[styles.trackFill, fillStyle]} />
            </View>
            <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
          </View>
        </GestureDetector>
        <Txt accessibilityElementsHidden importantForAccessibility="no" maxScale={1.2} style={styles.traitEnd}>{spec.right}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  grow: { flexGrow: 1 },
  shrink: { flex: 1, minWidth: 0 },
  shrinkText: { flexShrink: 1 },
  center: { textAlign: 'center' },
  alignEnd: { alignSelf: 'flex-end' },
  gapXs: { gap: SP.xs },
  gapSm: { gap: SP.sm },
  gapMd: { gap: SP.md },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: SP.sm2 },
  rowTight: { flexDirection: 'row', alignItems: 'center', gap: SP.xs2 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  pressed: { opacity: 0.7 },
  pressedRow: { opacity: 0.85 },

  // S15
  gutter: { paddingHorizontal: SP.lg },
  sectionHeader: { paddingHorizontal: SP.lg, paddingBottom: SP.md },
  homeNotice: { marginHorizontal: SP.lg, marginTop: SP.sm },
  cardRow: { gap: ROW_GAP, paddingHorizontal: SP.lg },
  createButton: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs, minHeight: 34,
    paddingHorizontal: SP.md, borderRadius: R.pill,
    backgroundColor: rgba(W.primary, 0.12), borderWidth: 1, borderColor: rgba(W.primary, 0.28),
  },
  glassCard: { borderRadius: R.lg, borderWidth: 1, overflow: 'hidden', backgroundColor: W.glass },
  continueCard: { padding: SP.md2, gap: SP.sm },
  scenarioCard: { padding: SP.base, minHeight: 200, justifyContent: 'space-between', gap: SP.md },
  badge: { paddingVertical: SP.xxs, paddingHorizontal: SP.sm, borderRadius: R.sm, flexShrink: 1 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm2 },
  tileOuter: { width: '48%' },
  tile: { minHeight: 112, borderRadius: R.lg, padding: SP.md2, backgroundColor: W.surface1 },
  tileName: { marginTop: SP.sm2 },
  tileRing: { ...StyleSheet.absoluteFillObject, borderRadius: R.lg, borderWidth: 2, borderColor: W.primary },
  dashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: rgba(W.text3, 0.35), borderRadius: R.lg },
  addTile: { minHeight: 112, padding: SP.md2, alignItems: 'center', justifyContent: 'center', gap: SP.xs2 },
  createFirst: { paddingVertical: SP.xl, paddingHorizontal: SP.lg, alignItems: 'center', gap: SP.sm },
  createFirstIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: W.primaryDim, borderWidth: 1, borderColor: rgba(W.primary, 0.2),
  },

  // Forms (S16, S18)
  form: { paddingHorizontal: SP.xl, paddingTop: SP.md, paddingBottom: SP.base, gap: SP.lg },
  form0: { gap: SP.lg },
  fieldLabel: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SP.sm, marginBottom: SP.sm2 },
  fieldHelp: { color: W.text2, marginBottom: SP.sm2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, maxWidth: '100%' },
  stepTitle: { alignItems: 'center', gap: SP.xs2, maxWidth: '100%' },
  input: {
    minHeight: 48, borderRadius: R.md, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.surface3,
    paddingHorizontal: SP.md2, paddingVertical: SP.md,
    color: W.text, fontFamily: resolveFont('user', 400), fontSize: TYPE.body.size,
  },
  inputFocused: { borderColor: rgba(W.primary, 0.45) },
  nameInput: { minHeight: 52, fontFamily: resolveFont('comp', 500), fontSize: TYPE.title3.size, textAlign: 'center' },
  backstory: { minHeight: 140, lineHeight: TYPE.body.lineHeight },
  noteInput: { minHeight: 72 },
  counter: { marginTop: SP.xs2, textAlign: 'right' },
  genderRow: { flexDirection: 'row', gap: SP.sm },
  voiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm2 },
  voiceCardOuter: { width: '48%' },
  voiceCard: {
    flexGrow: 1, minHeight: 116, borderRadius: R.lg, borderWidth: 2,
    backgroundColor: W.surface1, padding: SP.md, gap: SP.xs,
  },
  checkBadge: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: W.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  rememberRow: {
    minHeight: HIT, borderRadius: R.md2, padding: SP.md2, paddingLeft: SP.base,
    flexDirection: 'row', alignItems: 'center', gap: SP.md, overflow: 'hidden',
    borderWidth: 1, borderColor: W.primaryDim, backgroundColor: W.glass,
  },
  rememberIcon: { width: 32, height: 32, borderRadius: R.sm2, alignItems: 'center', justifyContent: 'center' },
  rememberCopy: { color: W.text2, marginTop: SP.xxs },
  footer: { paddingHorizontal: SP.xl, paddingTop: SP.md, paddingBottom: SP.base, gap: SP.sm2 },
  hint: { color: W.text2, textAlign: 'center' },
  review: { borderRadius: R.lg, backgroundColor: W.surface1, paddingHorizontal: SP.base },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.md2 },
  reviewDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: W.hairlineStrong },
  editButton: { paddingHorizontal: SP.xs2, paddingVertical: SP.xs },

  // Trait slider
  traitHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: SP.sm },
  traitValue: { color: W.text2, fontVariant: ['tabular-nums'] },
  traitRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  traitEnd: { fontSize: TYPE.title3.size, lineHeight: TYPE.title3.lineHeight },
  sliderHit: { flex: 1, height: HIT, justifyContent: 'center' },
  track: { marginHorizontal: THUMB / 2, height: 4, borderRadius: 2, backgroundColor: W.surface3 },
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: W.primary },
  thumb: {
    position: 'absolute', left: 0, top: (HIT - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: W.cream, borderWidth: 3, borderColor: W.primary, ...ELEV.low,
  },

  // S17
  endButton: { minHeight: 30, justifyContent: 'center', paddingHorizontal: SP.sm, borderRadius: R.pill },
  banner: {
    marginHorizontal: SP.base, marginTop: SP.sm2, marginBottom: SP.xs2, minHeight: HIT,
    borderRadius: R.sm2, paddingVertical: SP.xs2, paddingLeft: SP.md, paddingRight: SP.sm,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, overflow: 'hidden',
    borderWidth: 1, borderLeftWidth: 2, backgroundColor: W.glass,
  },
  thread: { paddingHorizontal: SP.base, paddingVertical: SP.sm, gap: SP.sm },
  threadSkeleton: { gap: SP.sm2, paddingTop: SP.xs },
  opener: {
    borderRadius: R.lg, padding: SP.base, gap: SP.sm2, overflow: 'hidden',
    borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass,
  },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, paddingTop: SP.xs },
  turnNote: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs2, alignSelf: 'flex-end',
    paddingTop: SP.xs, paddingHorizontal: SP.xs,
  },
  alignStart: { alignSelf: 'flex-start' },
  cutText: { alignSelf: 'flex-start', paddingTop: SP.xs, paddingHorizontal: SP.xs, color: W.text3 },
  chipWrap: { position: 'absolute', left: 0, right: 0, bottom: SP.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs2, minHeight: 34,
    paddingHorizontal: SP.md2, borderRadius: R.pill, overflow: 'hidden',
    backgroundColor: W.glassBar, borderWidth: 1, borderColor: W.hairlineStrong,
  },
  crisis: {
    alignSelf: 'stretch', marginVertical: SP.xs2, borderRadius: R.lg, padding: SP.base, gap: SP.md,
    backgroundColor: rgba(W.gold, 0.08), borderWidth: 1, borderColor: rgba(W.gold, 0.18),
  },
  crisisIcon: {
    width: 32, height: 32, borderRadius: R.sm2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.gold, 0.12), borderWidth: 1, borderColor: rgba(W.gold, 0.2),
  },
  crisisRow: {
    minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: SP.sm2,
    paddingVertical: SP.sm2, paddingHorizontal: SP.md, borderRadius: R.sm2,
    backgroundColor: W.glassSoft, borderWidth: 1, borderColor: rgba(W.gold, 0.1),
  },
  crisisRowIcon: {
    width: 30, height: 30, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.gold, 0.1),
  },
  crisisMore: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, alignSelf: 'flex-start', paddingVertical: SP.xs },
  memoryRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm2, borderRadius: R.md,
    paddingVertical: SP.xs2, paddingLeft: SP.md, paddingRight: SP.xs,
    backgroundColor: rgba(W.gold, 0.06), borderWidth: 1, borderColor: rgba(W.gold, 0.15),
  },
});
