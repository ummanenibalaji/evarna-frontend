// tabEvents.ts — tapping the tab you're already on.
//
// As in every iOS app, a second tap on the selected tab scrolls its root
// screen back to the top. Tab roots stay mounted, so the router can't reach
// into their ScrollViews; instead a root that scrolls subscribes here and the
// router emits when its tab is tapped again.

import { useEffect, useRef } from 'react';
import type { TabId } from '../components/BottomNav';

const listeners = new Map<TabId, Set<() => void>>();

/** Tells the root screen of `tab` that its tab was tapped again. */
export function emitTabReselect(tab: TabId): void {
  listeners.get(tab)?.forEach(cb => cb());
}

/**
 * Runs `onReselect` when the user taps this screen's tab while it's already
 * selected, e.g. `useTabReselect('home', () => scrollRef.current?.scrollTo({ y: 0 }))`.
 */
export function useTabReselect(tab: TabId, onReselect: () => void): void {
  const latest = useRef(onReselect);
  latest.current = onReselect;
  useEffect(() => {
    const cb = () => latest.current();
    const set = listeners.get(tab) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(tab, set);
    return () => { set.delete(cb); };
  }, [tab]);
}
