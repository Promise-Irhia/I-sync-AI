import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { BlurView } from 'expo-blur';
import { Colors } from '@/constants/colors';
import { BLEProvider } from '@/context/BLEContext';
import { FallDetectionProvider } from '@/context/FallDetectionContext';

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'heart.fill', selected: 'heart.fill' }} />
        <Label>Health</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="medications">
        <Icon sf={{ default: 'pill', selected: 'pill.fill' }} />
        <Label>Medications</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="nutrition">
        <Icon sf={{ default: 'fork.knife', selected: 'fork.knife' }} />
        <Label>Nutrition</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="appointments">
        <Icon sf={{ default: 'calendar', selected: 'calendar.badge.plus' }} />
        <Label>Appointments</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assistant">
        <Icon sf={{ default: 'message', selected: 'message.fill' }} />
        <Label>AI Assistant</Label>
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
        tabBarActiveTintColor: Colors.primary,
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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Health',
          tabBarIcon: ({ color }) => <TabIcon name="heart" color={color} />,
        }}
      />
      <Tabs.Screen
        name="medications"
        options={{
          title: 'Medications',
          tabBarIcon: ({ color }) => <TabIcon name="medkit" color={color} />,
        }}
      />
      <Tabs.Screen
        name="nutrition"
        options={{
          title: 'Nutrition',
          tabBarIcon: ({ color }) => <TabIcon name="nutrition" color={color} />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Appointments',
          tabBarIcon: ({ color }) => <TabIcon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'AI',
          tabBarIcon: ({ color }) => <TabIcon name="chatbubble-ellipses" color={color} />,
        }}
      />
      <Tabs.Screen
        name="fall-detection"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon name="person" color={color} />,
        }}
      />
    </Tabs>
  );
}

import { Ionicons } from '@expo/vector-icons';
function TabIcon({ name, color }: { name: any; color: string }) {
  return <Ionicons name={name} size={22} color={color} />;
}

export default function PatientLayout() {
  if (isLiquidGlassAvailable()) return <BLEProvider><FallDetectionProvider><NativeTabLayout /></FallDetectionProvider></BLEProvider>;
  return <BLEProvider><FallDetectionProvider><ClassicTabLayout /></FallDetectionProvider></BLEProvider>;
}
