const primary = '#06B6D4';
const primaryDark = '#0284C7';
const secondary = '#10B981';
const danger = '#EF4444';
const warning = '#F59E0B';
const purple = '#8B5CF6';

export const Colors = {
  primary,
  primaryDark,
  secondary,
  danger,
  warning,
  purple,

  dark: {
    bg: '#070D1A',
    bgSecondary: '#0E1729',
    card: '#111D33',
    cardBorder: '#1E2D4A',
    text: '#F1F5F9',
    textSub: '#94A3B8',
    textMuted: '#64748B',
    tabBar: '#0A1224',
    input: '#162035',
    inputBorder: '#1E2D4A',
    divider: '#1E2D4A',
  },

  light: {
    bg: '#EFF6FF',
    bgSecondary: '#F8FAFC',
    card: '#FFFFFF',
    cardBorder: '#E2E8F0',
    text: '#0F172A',
    textSub: '#475569',
    textMuted: '#94A3B8',
    tabBar: '#FFFFFF',
    input: '#F1F5F9',
    inputBorder: '#CBD5E1',
    divider: '#E2E8F0',
  },
};

export default {
  light: {
    text: Colors.light.text,
    background: Colors.light.bg,
    tint: primary,
    tabIconDefault: Colors.light.textMuted,
    tabIconSelected: primary,
  },
  dark: {
    text: Colors.dark.text,
    background: Colors.dark.bg,
    tint: primary,
    tabIconDefault: Colors.dark.textMuted,
    tabIconSelected: primary,
  },
};
