import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, useColorScheme } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';

export default function IndexScreen() {
  const { user, isLoading } = useAuth();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.replace('/(auth)/login');
      } else if (user.role === 'patient') {
        router.replace('/(patient)');
      } else {
        router.replace('/(doctor)');
      }
    }
  }, [user, isLoading]);

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
