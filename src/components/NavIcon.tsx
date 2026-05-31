// NavIcon.tsx — all line icons, ported from system.jsx NavIcon().
// Uses react-native-svg. Default stroke style matches the web props:
// strokeWidth 1.8, round caps/joins, no fill.

import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { W } from '../theme/theme';

export type IconName =
  | 'chat' | 'grid' | 'mask' | 'gear' | 'phone' | 'mic' | 'send' | 'back' | 'close'
  | 'down' | 'bell' | 'plus' | 'check' | 'sparkle' | 'shield' | 'eye-off' | 'fire'
  | 'lock' | 'heart' | 'compass' | 'target' | 'briefcase' | 'book' | 'globe' | 'trash'
  | 'search' | 'kebab' | 'right' | 'mute' | 'two' | 'flash' | 'speaker' | 'play' | 'pause';

interface NavIconProps {
  name: IconName;
  color?: string;
  size?: number;
}

export function NavIcon({ name, color = W.text, size = 22 }: NavIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
  };
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  switch (name) {
    case 'chat':
      return <Svg {...common}><Path {...stroke} d="M21 12c0 4.4-4 8-9 8a10 10 0 0 1-3.5-.6L4 21l1.4-4A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z" /></Svg>;
    case 'grid':
      return <Svg {...common}><Rect {...stroke} x={4} y={4} width={7} height={7} rx={1.5} /><Rect {...stroke} x={13} y={4} width={7} height={7} rx={1.5} /><Rect {...stroke} x={4} y={13} width={7} height={7} rx={1.5} /><Rect {...stroke} x={13} y={13} width={7} height={7} rx={1.5} /></Svg>;
    case 'mask':
      return <Svg {...common}><Path {...stroke} d="M5 7c0-1 1-2 2-2h10c1 0 2 1 2 2v5c0 4-3 7-7 7s-7-3-7-7V7z" /><Circle cx={9.5} cy={11} r={1} fill={color} /><Circle cx={14.5} cy={11} r={1} fill={color} /></Svg>;
    case 'gear':
      return <Svg {...common}><Circle {...stroke} cx={12} cy={12} r={3} /><Path {...stroke} d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
    case 'phone':
      return <Svg {...common}><Path {...stroke} d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.7.6a2 2 0 0 1 1.7 2z" /></Svg>;
    case 'mic':
      return <Svg {...common}><Rect {...stroke} x={9} y={2} width={6} height={13} rx={3} /><Path {...stroke} d="M19 11a7 7 0 0 1-14 0M12 18v3" /></Svg>;
    case 'send':
      return <Svg {...common}><Path {...stroke} d="M5 12h14M13 6l6 6-6 6" /></Svg>;
    case 'back':
      return <Svg {...common}><Path {...stroke} d="M15 18l-6-6 6-6" /></Svg>;
    case 'close':
      return <Svg {...common}><Path {...stroke} d="M6 6l12 12M18 6l-12 12" /></Svg>;
    case 'down':
      return <Svg {...common}><Path {...stroke} d="M6 9l6 6 6-6" /></Svg>;
    case 'bell':
      return <Svg {...common}><Path {...stroke} d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M14 21a2 2 0 0 1-4 0" /></Svg>;
    case 'plus':
      return <Svg {...common}><Path {...stroke} d="M12 5v14M5 12h14" /></Svg>;
    case 'check':
      return <Svg {...common}><Path {...stroke} d="M5 12l5 5L20 6" /></Svg>;
    case 'sparkle':
      return <Svg {...common}><Path {...stroke} d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></Svg>;
    case 'shield':
      return <Svg {...common}><Path {...stroke} d="M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" /><Path {...stroke} d="M9 12l2 2 4-4" /></Svg>;
    case 'eye-off':
      return <Svg {...common}><Path {...stroke} d="M3 3l18 18M10.5 6.5A10 10 0 0 1 12 6c5 0 9 4 10 6a13 13 0 0 1-2.5 3.5M6.5 6.5C4 8 2.2 10.5 2 12c1 2 5 6 10 6 1.5 0 2.9-.3 4.2-.8M9 9a3 3 0 0 0 4.2 4.2" /></Svg>;
    case 'fire':
      return <Svg {...common}><Path {...stroke} d="M12 2c1 4 4 6 4 10a4 4 0 0 1-8 0c0-2 1.5-3 2-5 .5 1 2 1.5 2 5" /></Svg>;
    case 'lock':
      return <Svg {...common}><Rect {...stroke} x={4} y={11} width={16} height={10} rx={2} /><Path {...stroke} d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
    case 'heart':
      return <Svg {...common}><Path {...stroke} d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" /></Svg>;
    case 'compass':
      return <Svg {...common}><Circle {...stroke} cx={12} cy={12} r={9} /><Path {...stroke} d="M16 8l-2 6-6 2 2-6 6-2z" /></Svg>;
    case 'target':
      return <Svg {...common}><Circle {...stroke} cx={12} cy={12} r={9} /><Circle {...stroke} cx={12} cy={12} r={5} /><Circle cx={12} cy={12} r={1.5} fill={color} /></Svg>;
    case 'briefcase':
      return <Svg {...common}><Rect {...stroke} x={3} y={7} width={18} height={13} rx={2} /><Path {...stroke} d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>;
    case 'book':
      return <Svg {...common}><Path {...stroke} d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2zM7 3v18" /></Svg>;
    case 'globe':
      return <Svg {...common}><Circle {...stroke} cx={12} cy={12} r={9} /><Path {...stroke} d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>;
    case 'trash':
      return <Svg {...common}><Path {...stroke} d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" /></Svg>;
    case 'search':
      return <Svg {...common}><Circle {...stroke} cx={11} cy={11} r={7} /><Path {...stroke} d="M21 21l-5-5" /></Svg>;
    case 'kebab':
      return <Svg {...common}><Circle cx={12} cy={6} r={1} fill={color} /><Circle cx={12} cy={12} r={1} fill={color} /><Circle cx={12} cy={18} r={1} fill={color} /></Svg>;
    case 'right':
      return <Svg {...common}><Path {...stroke} d="M9 6l6 6-6 6" /></Svg>;
    case 'mute':
      return <Svg {...common}><Path {...stroke} d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M12 2a3 3 0 0 1 3 3v6M19 11a7 7 0 0 1-1.6 4.4M12 18v3" /></Svg>;
    case 'two':
      return <Svg {...common}><Path {...stroke} d="M21 12c0 4.4-4 8-9 8a10 10 0 0 1-3.5-.6L4 21l1.4-4A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z" /><Path {...stroke} d="M8 11h.01M12 11h.01M16 11h.01" /></Svg>;
    case 'flash':
      return <Svg {...common}><Path {...stroke} d="M13 2L4 14h8l-1 8 9-12h-8l1-8z" /></Svg>;
    case 'speaker':
      return <Svg {...common}><Path {...stroke} d="M11 5L6 9H2v6h4l5 4V5z M15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12" /></Svg>;
    case 'play':
      return <Svg {...common}><Path d="M6 4l14 8L6 20V4z" fill={color} /></Svg>;
    case 'pause':
      return <Svg {...common}><Rect x={6} y={4} width={4} height={16} rx={1} fill={color} /><Rect x={14} y={4} width={4} height={16} rx={1} fill={color} /></Svg>;
    default:
      return null;
  }
}
