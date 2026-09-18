// CrisisResourceCard.tsx — support someone can reach right now, shown inside
// the conversation right after the server's crisis response.
//
// The user stays in their thread with the composer still working; nothing
// navigates away. Numbers come from crisisResources() for the region the
// phone is in, so nobody in India is handed a US hotline. "More support"
// opens the full resources screen.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  canOpenCrisisResource, crisisResources, openCrisisResource, type CrisisResource,
} from '../data/crisis';
import { announce } from '../hooks/useAccessibilityPrefs';
import { enter, PRESS_DELAY, usePressFeedback } from '../theme/motion';
import { HIT, R, rgba, SP, W } from '../theme/theme';
import { InlineNotice } from './Atoms';
import { NavIcon, type IconName } from './NavIcon';
import { Txt } from './Txt';

const KIND_ICON: Record<CrisisResource['kind'], IconName> = { call: 'phone', text: 'chat', web: 'globe' };

function hintFor(r: CrisisResource): string {
  if (r.kind === 'call') return `Calls ${r.value}`;
  if (r.kind === 'text') return 'Opens Messages';
  return 'Opens in your browser';
}

// Cards already announced this app run, by `announceKey`. A virtualized
// thread unmounts a card scrolled far out of view and mounts it again on the
// way back; that is not news.
const announced = new Set<string>();

// The helpline first, then the emergency number. The full list lives on the
// resources screen behind "More support". Worked out once: the region
// doesn't change while the app runs.
let cardLines: CrisisResource[] | null = null;
const linesForCard = () => {
  if (!cardLines) {
    const { emergency, resources } = crisisResources();
    cardLines = resources.length ? [resources[0], emergency] : [emergency];
  }
  return cardLines;
};

export function CrisisResourceCard({ onMore, announceKey, animateIn = true, silent = false }: {
  onMore?: () => void;
  /** Identifies the message this card follows, so it is announced only once. */
  announceKey?: string;
  /** Rise into place on mount. False for a card shown with history. */
  animateIn?: boolean;
  /** Not announced at all (a card that was already there, e.g. history). */
  silent?: boolean;
}) {
  const [lines] = useState(linesForCard);
  const [unopened, setUnopened] = useState<CrisisResource | null>(null);
  const [entering] = useState(() => (animateIn ? enter.fadeUp : undefined));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (silent || (announceKey !== undefined && announced.has(announceKey))) return;
    if (announceKey !== undefined) announced.add(announceKey);
    announce('Support you can reach right now is listed in the conversation.');
  }, [announceKey, silent]);

  const open = async (r: CrisisResource) => {
    setUnopened(null);
    const ok = await openCrisisResource(r);
    // An iPad can't place a call: keep the number on screen and say so.
    if (!ok && mounted.current) setUnopened(r);
  };

  return (
    <Animated.View entering={entering} style={styles.card}>
      <View style={styles.head}>
        <NavIcon name="heart" color={W.warning} size={16} />
        <Txt variant="subhead" weight={600} heading maxScale={1.4} style={styles.title}>
          Talk to someone now
        </Txt>
      </View>
      <Txt variant="footnote" style={styles.lead}>You don't have to handle this on your own.</Txt>

      {lines.map(r => <ResourceRow key={r.id} resource={r} onOpen={open} />)}

      {unopened ? (
        <InlineNotice tone="warning" text={`Couldn't open that here. ${unopened.detail}.`} />
      ) : null}

      {onMore ? (
        <Pressable
          onPress={onMore}
          // The card sits in a scrolling thread: a scroll that starts here
          // shouldn't press it.
          unstable_pressDelay={PRESS_DELAY}
          accessibilityRole="button"
          accessibilityHint="Opens more places to find help"
          hitSlop={{ top: SP.xs, bottom: SP.xs }}
          style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}
        >
          <Txt variant="subhead" weight={600} color={W.warning}>More support</Txt>
          <NavIcon name="right" color={W.warning} size={14} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function ResourceRow({ resource: r, onOpen }: { resource: CrisisResource; onOpen: (r: CrisisResource) => void }) {
  const press = usePressFeedback({ scale: 0.98 });
  const label = `${r.name}. ${r.detail}${r.hours ? `. ${r.hours}` : ''}`;
  const body = (
    <>
      <View style={styles.icon}>
        <NavIcon name={KIND_ICON[r.kind]} color={W.warning} size={16} />
      </View>
      <View style={styles.rowText}>
        <Txt variant="subhead" weight={600} color={W.text}>{r.name}</Txt>
        <Txt variant="footnote" color={W.text2}>{r.detail}</Txt>
        {r.hours ? <Txt variant="caption" color={W.text3}>{r.hours}</Txt> : null}
      </View>
    </>
  );

  // Some regions only name what to do ("your local emergency number"):
  // there is nothing to dial, so it reads as text rather than a button.
  if (!canOpenCrisisResource(r)) {
    return <View accessible accessibilityLabel={label} style={styles.row}>{body}</View>;
  }
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={() => onOpen(r)}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        unstable_pressDelay={PRESS_DELAY}
        accessibilityRole={r.kind === 'web' ? 'link' : 'button'}
        accessibilityLabel={label}
        accessibilityHint={hintFor(r)}
        style={({ pressed }) => [styles.row, styles.rowTappable, pressed ? styles.rowPressed : null]}
      >
        {body}
        <NavIcon name={r.kind === 'web' ? 'external' : 'right'} color={W.text3} size={14} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: SP.sm2, padding: SP.md2, gap: SP.sm, borderRadius: R.lg, borderWidth: 1,
    backgroundColor: rgba(W.warning, 0.07), borderColor: rgba(W.warning, 0.28),
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  title: { flex: 1, color: W.text },
  lead: { color: W.text2 },
  row: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, paddingHorizontal: SP.sm2, borderRadius: R.md },
  rowTappable: { backgroundColor: rgba(W.warning, 0.08) },
  rowPressed: { backgroundColor: rgba(W.warning, 0.16) },
  icon: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.warning, 0.14),
  },
  rowText: { flex: 1, gap: 1 },
  more: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: SP.xs, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
});
