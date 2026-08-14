// BottomNav.tsx — "Ember Dusk" floating tab bar. A rounded glass capsule
// inset from the screen edges; the active tab is an aurora-filled pill that
// carries both the icon and its label, inactive tabs are icon-only. The pill
// slides between tabs, and because only one tab shows text the row is
// measured per-tab rather than assuming equal widths.

import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, LayoutChangeEvent } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from './Txt';
import { NavIcon, IconName } from './NavIcon';
import { W, GRAD } from '../theme/theme';

export type TabId = 'home' | 'studio' | 'sandbox' | 'settings';

interface BottomNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  sandboxComingSoon?: boolean;
}

export function BottomNav({ active, onChange, sandboxComingSoon = true }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const tabs: { id: TabId; label: string; icon: IconName; badge?: string | null }[] = [
    { id: 'home',     label: 'Home',     icon: 'chat' },
    { id: 'studio',   label: 'Studio',   icon: 'grid' },
    { id: 'sandbox',  label: 'Sandbox',  icon: 'mask', badge: sandboxComingSoon ? 'Soon' : null },
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ];

  // Measured geometry of each tab, so the aurora pill can be placed exactly
  // over the active one regardless of the label width it expands to.
  const [frames, setFrames] = useState<Record<string, { x: number; w: number }>>({});
  const slideX = useRef(new Animated.Value(0)).current;
  const slideW = useRef(new Animated.Value(0)).current;
  const activeFrame = frames[active];

  useEffect(() => {
    if (!activeFrame) return;
    Animated.parallel([
      Animated.spring(slideX, { toValue: activeFrame.x, useNativeDriver: false, tension: 90, friction: 13 }),
      Animated.spring(slideW, { toValue: activeFrame.w, useNativeDriver: false, tension: 90, friction: 13 }),
    ]).start();
  }, [activeFrame?.x, activeFrame?.w]);

  const onTabLayout = (id: TabId) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setFrames(prev => (prev[id]?.x === x && prev[id]?.w === width ? prev : { ...prev, [id]: { x, w: width } }));
  };

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), zIndex: 5 }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          padding: 8, borderRadius: 30,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
          backgroundColor: W.glassBar,
          overflow: 'hidden',
          shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 44, shadowOffset: { width: 0, height: 20 },
          elevation: 12,
        }}
      >
        <BlurView pointerEvents="none" intensity={44} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        {/* Inset top highlight — the capsule catching light from above */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

        {/* Aurora pill — glides + resizes onto the active tab */}
        {activeFrame ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', left: slideX, top: 8, bottom: 8, width: slideW,
              borderRadius: 22, overflow: 'hidden',
              shadowColor: W.rose, shadowOpacity: 0.35, shadowRadius: 22, shadowOffset: { width: 0, height: 8 },
            }}
          >
            <LinearGradient
              colors={[...GRAD.aurora]}
              locations={[0, 0.55, 1]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        ) : null}

        {tabs.map(t => {
          const isActive = t.id === active;
          const tint = isActive ? '#FFFFFF' : W.text2;
          return (
            <Pressable
              key={t.id}
              onPress={() => onChange(t.id)}
              onLayout={onTabLayout(t.id)}
              android_ripple={{ color: 'rgba(255,138,118,0.12)', borderless: true }}
              style={{
                height: 44,
                paddingHorizontal: isActive ? 18 : 0,
                width: isActive ? undefined : 58,
                borderRadius: 22,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <NavIcon name={t.icon} color={tint} size={isActive ? 19 : 21} />
              {isActive ? (
                <Txt font="user" weight={700} style={{ fontSize: 11, color: '#fff', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                  {t.label}
                </Txt>
              ) : null}
              {t.badge && !isActive ? (
                <View style={{
                  position: 'absolute', top: -2, right: 2,
                  backgroundColor: W.gold,
                  paddingVertical: 1, paddingHorizontal: 6, borderRadius: 7,
                }}>
                  <Txt font="user" weight={700} style={{ fontSize: 8, color: '#140D11', letterSpacing: 0.3 }}>{t.badge}</Txt>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
