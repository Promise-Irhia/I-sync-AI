import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  useColorScheme,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { login, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      if (user.role === 'patient') {
        router.replace('/(patient)');
      } else {
        router.replace('/(doctor)');
      }
    }
  }, [user]);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Info', 'Please enter your email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await login(email.trim(), password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Login Failed', error.message || 'Check your credentials and try again.');
    } finally {
      setIsLoading(false);
    }
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const WEB = Platform.OS === 'web';

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 24, paddingBottom: botPad + 24 },
          WEB && styles.scrollWeb,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.inner, WEB && styles.innerWeb]}>
          <View style={styles.header}>
            <View style={[styles.logoCircle, { backgroundColor: Colors.primary + '18' }]}>
              <Ionicons name="pulse" size={36} color={Colors.primary} />
            </View>
            <Text style={[styles.appName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>I-Sync</Text>
            <Text style={[styles.tagline, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              Smart Healthcare Monitoring
            </Text>
          </View>

          <View style={[styles.formCard, { backgroundColor: WEB ? C.card : 'transparent', borderColor: C.cardBorder }]}>
            <Text style={[styles.formTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Welcome back</Text>
            <Text style={[styles.formSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>Sign in to your account</Text>

            <View style={styles.fields}>
              <View>
                <Text style={[styles.label, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Email</Text>
                <View style={[styles.inputWrap, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                  <Ionicons name="mail-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: C.text, fontFamily: 'Inter_400Regular' }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={C.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View>
                <Text style={[styles.label, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Password</Text>
                <View style={[styles.inputWrap, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                  <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: C.text, fontFamily: 'Inter_400Regular' }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Your password"
                    placeholderTextColor={C.textMuted}
                    secureTextEntry={!showPassword}
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                  </Pressable>
                </View>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? <ActivityIndicator color="#fff" /> : (
                <Text style={[styles.primaryBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Sign In</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              Don't have an account?
            </Text>
            <Pressable onPress={() => router.push('/(auth)/register')}>
              <Text style={[styles.footerLink, { fontFamily: 'Inter_600SemiBold' }]}>{' '}Create one</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
  scrollWeb: { alignItems: 'center' },
  inner: { width: '100%' },
  innerWeb: { maxWidth: 440 },
  header: { alignItems: 'center', marginBottom: 36, gap: 10 },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  appName: { fontSize: 34, letterSpacing: -0.5 },
  tagline: { fontSize: 14 },
  formCard: {
    gap: 20,
    borderRadius: 20,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    padding: Platform.OS === 'web' ? 28 : 0,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' } as any)
      : {}),
  },
  formTitle: { fontSize: 26, letterSpacing: -0.3 },
  formSub: { fontSize: 14, marginTop: -12 },
  fields: { gap: 16 },
  label: { fontSize: 13, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, height: '100%' },
  eyeBtn: { padding: 4 },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, color: Colors.primary },
});
