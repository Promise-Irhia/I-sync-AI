import React, { useEffect } from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl } from '@/lib/query-client';
import { fetch } from 'expo/fetch';

let Notifications: typeof import('expo-notifications') | null = null;
if (Platform.OS !== 'web') {
  Notifications = require('expo-notifications');
}

// Show alerts even when the app is foregrounded
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'stethoscope', selected: 'stethoscope' }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="appointments">
        <Icon sf={{ default: 'calendar', selected: 'calendar' }} />
        <Label>Schedule</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="prescriptions">
        <Icon sf={{ default: 'pill', selected: 'pill.fill' }} />
        <Label>Rx</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assistant">
        <Icon sf={{ default: 'message', selected: 'message.fill' }} />
        <Label>AI</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: 'person', selected: 'person.fill' }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.purple,
        tabBarInactiveTintColor: C.textMuted,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : C.tabBar,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: C.divider,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={95} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.tabBar }]} />
          ) : null,
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="appointments" options={{ title: 'Schedule', tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="prescriptions" options={{ title: 'Rx', tabBarIcon: ({ color }) => <Ionicons name="document-text-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="assistant" options={{ title: 'AI', tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={22} color={color} /> }} />
    </Tabs>
  );
}

export default function DoctorLayout() {
  const { authHeader } = useAuth();
  const base = getApiUrl();

  // Register Expo push token so the server can send fall alerts to this caregiver
  useEffect(() => {
    if (Platform.OS === 'web' || !Notifications) return;
    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await fetch(`${base}api/push-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ token: tokenData.data }),
        });
      } catch {}
    })();
  }, []);

  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
