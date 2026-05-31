// BottomNav.tsx — premium glass tab bar with an animated indicator pill that
// glides between tabs. Sits above the device home bar via safe-area insets.

import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, Easing, LayoutChangeEvent } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from './Txt';
import { NavIcon, IconName } from './NavIcon';
import { W, alpha } from '../theme/theme';

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

  const [tabWidth, setTabWidth] = useState(0);
  const indicator = useRef(new Animated.Value(0)).current;
  const activeIdx = tabs.findIndex(t => t.id === active);

  useEffect(() => {
    Animated.spring(indicator, {
      toValue: activeIdx,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [activeIdx]);

  const onRowLayout = (e: LayoutChangeEvent) => {
    setTabWidth(e.nativeEvent.layout.width / tabs.length);
  };

  const indicatorTranslate = indicator.interpolate({
    inputRange: tabs.map((_, i) => i),
    outputRange: tabs.map((_, i) => i * tabWidth),
  });

  return (
    <View
      style={{
        paddingBottom: Math.max(insets.bottom, 10),
        paddingTop: 10,
        backgroundColor: 'rgba(8,9,13,0.88)',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
        zIndex: 2,
      }}
    >
      <BlurView intensity={60} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {/* Soft top glow */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: -40, marginLeft: -100, width: 200, height: 80, borderRadius: 100, backgroundColor: W.primary, opacity: 0.06 }} />

      <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 60, position: 'relative' }} onLayout={onRowLayout}>
        {/* Animated indicator pill — glides under active tab */}
        {tabWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 4, left: 0, height: 52, width: tabWidth,
              transform: [{ translateX: indicatorTranslate }],
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <View style={{
              width: tabWidth - 16, height: 48, borderRadius: 16, overflow: 'hidden',
              borderWidth: 1, borderColor: alpha(W.primary, '30'),
              shadowColor: W.primary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
            }}>
              <LinearGradient
                colors={[alpha(W.primary, '33'), alpha(W.primary, '14')]}
                start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
              />
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            </View>
          </Animated.View>
        )}

        {tabs.map(t => {
          const isActive = t.id === active;
          const tint = isActive ? W.cream : W.text2;
          return (
            <Pressable
              key={t.id}
              onPress={() => onChange(t.id)}
              android_ripple={{ color: 'rgba(124,114,255,0.10)', borderless: true }}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, position: 'relative' }}
            >
              <View style={{ height: 26, width: 44, alignItems: 'center', justifyContent: 'center' }}>
                <NavIcon name={t.icon} color={tint} />
              </View>
              <Txt font="user" weight={isActive ? 600 : 500} style={{ fontSize: 10, color: tint, letterSpacing: 0.6, textTransform: 'uppercase' }}>{t.label}</Txt>
              {t.badge && (
                <View style={{
                  position: 'absolute', top: 4, right: '50%', marginRight: -28,
                  backgroundColor: W.accent,
                  paddingVertical: 1, paddingHorizontal: 6, borderRadius: 7,
                  shadowColor: W.accent, shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
                }}>
                  <Txt font="user" weight={700} style={{ fontSize: 8, color: W.bg, letterSpacing: 0.3 }}>{t.badge}</Txt>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
