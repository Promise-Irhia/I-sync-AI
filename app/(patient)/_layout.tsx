import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { BLEProvider } from '@/context/BLEContext';
import { FallDetectionProvider } from '@/context/FallDetectionContext';

function TabIcon({ name, color }: { name: any; color: string }) {
  return <Ionicons name={name} size={22} color={color} />;
}

export default function PatientLayout() {
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <BLEProvider>
      <FallDetectionProvider>
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
      </FallDetectionProvider>
    </BLEProvider>
  );
}
