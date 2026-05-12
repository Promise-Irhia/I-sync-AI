import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Platform,
  useColorScheme,
  StatusBar,
  Text,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

const MAX_WIDTH = 520;

export function ResponsiveContainer({ children, style }: { children: React.ReactNode; style?: any }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={[styles.webWrapper, style]}>
      <View style={styles.webInner}>{children}</View>
    </View>
  );
}

type ScreenProps = {
  children: React.ReactNode;
  scrollable?: boolean;
  padHorizontal?: boolean;
  padTop?: boolean;
  padBottom?: number;
  backgroundColor?: string;
  style?: any;
  contentStyle?: any;
};

export function Screen({
  children,
  scrollable = true,
  padHorizontal = true,
  padTop = true,
  padBottom = 120,
  backgroundColor,
  style,
  contentStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const bg = backgroundColor ?? C.bg;

  const topPad = padTop ? (Platform.OS === 'web' ? 72 : insets.top + 8) : 0;
  const hPad = padHorizontal ? 20 : 0;

  const innerContent = (
    <View
      style={[
        styles.innerContent,
        Platform.OS === 'web' && styles.webConstraint,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  if (!scrollable) {
    return (
      <View style={[styles.root, { backgroundColor: bg }, style]}>
        <View
          style={[
            styles.fill,
            { paddingTop: topPad, paddingHorizontal: hPad, paddingBottom: padBottom },
          ]}
        >
          {innerContent}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: bg }, style]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: topPad,
            paddingHorizontal: hPad,
            paddingBottom: padBottom,
          },
        ]}
      >
        {innerContent}
      </ScrollView>
    </View>
  );
}

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  showBack?: boolean;
};

export function PageHeader({ title, subtitle, right, showBack }: PageHeaderProps) {
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderLeft}>
        {showBack && (
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          </Pressable>
        )}
        <View>
          <Text style={[styles.pageTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.pageSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right && <View>{right}</View>}
    </View>
  );
}

type CardProps = {
  children: React.ReactNode;
  style?: any;
  elevated?: boolean;
};

export function Card({ children, style, elevated = false }: CardProps) {
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: C.card, borderColor: C.cardBorder },
        elevated && (Platform.OS === 'web' ? styles.webElevated : styles.nativeElevated),
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  webWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  webInner: {
    width: '100%',
    maxWidth: MAX_WIDTH,
  },
  root: { flex: 1 },
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  innerContent: { flex: 1 },
  webConstraint: {
    maxWidth: MAX_WIDTH,
    width: '100%',
    alignSelf: 'center' as const,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  pageTitle: { fontSize: 24, letterSpacing: -0.3 },
  pageSub: { fontSize: 13, marginTop: 2 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  webElevated: {
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' } as any)
      : {}),
  },
  nativeElevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
});
