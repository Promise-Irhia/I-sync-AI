import React, { useState, useEffect, useRef } from 'react';
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

type Role = 'patient' | 'doctor';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { register, user } = useAuth();

  const [role, setRole] = useState<Role>('patient');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobError, setDobError] = useState('');
  const [gender, setGender] = useState('');
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

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Missing Info', 'Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    if (dateOfBirth && dobError) {
      Alert.alert('Invalid Date of Birth', dobError);
      return;
    }
    setIsLoading(true);
    try {
      await register({ role, name: name.trim(), email: email.trim(), password, phone: phone.trim(), dateOfBirth: dateOfBirth.trim(), gender });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Registration Failed', error.message || 'Please try again.');
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
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 24 }, WEB && styles.scrollWeb]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={[styles.inner, WEB && styles.innerWeb]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>

        <Text style={[styles.title, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
          Create account
        </Text>
        <Text style={[styles.sub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
          Join I-Sync healthcare platform
        </Text>

        <View style={styles.roleRow}>
          {(['patient', 'doctor'] as Role[]).map(r => (
            <Pressable
              key={r}
              style={[
                styles.roleBtn,
                { borderColor: role === r ? Colors.primary : C.cardBorder, backgroundColor: role === r ? Colors.primary + '15' : C.card },
              ]}
              onPress={() => setRole(r)}
            >
              <Ionicons
                name={r === 'patient' ? 'person-outline' : 'medical-outline'}
                size={20}
                color={role === r ? Colors.primary : C.textSub}
              />
              <Text style={[
                styles.roleText,
                { color: role === r ? Colors.primary : C.textSub, fontFamily: role === r ? 'Inter_600SemiBold' : 'Inter_400Regular' }
              ]}>
                {r === 'patient' ? 'Patient' : 'Care Giver'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.fields}>
          <Field label="Full Name *" icon="person-outline" value={name} onChange={setName} placeholder="Dr. John Smith" C={C} />
          <Field label="Email *" icon="mail-outline" value={email} onChange={setEmail} placeholder="you@example.com" C={C} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Phone" icon="call-outline" value={phone} onChange={setPhone} placeholder="+1 234 567 8900" C={C} keyboardType="phone-pad" />
          <DobField value={dateOfBirth} onChange={setDateOfBirth} onError={setDobError} C={C} />

          <View>
            <Text style={[styles.label, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Gender</Text>
            <View style={styles.genderRow}>
              {['Male', 'Female', 'Other'].map(g => (
                <Pressable
                  key={g}
                  style={[styles.genderBtn, {
                    backgroundColor: gender === g ? Colors.primary + '20' : C.input,
                    borderColor: gender === g ? Colors.primary : C.inputBorder,
                  }]}
                  onPress={() => setGender(g)}
                >
                  <Text style={[styles.genderText, { color: gender === g ? Colors.primary : C.textSub, fontFamily: 'Inter_500Medium' }]}>
                    {g}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text style={[styles.label, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Password *</Text>
            <View style={[styles.inputWrap, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
              <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text, fontFamily: 'Inter_400Regular' }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Min. 6 characters"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Field label="Confirm Password *" icon="shield-checkmark-outline" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat password" C={C} secureTextEntry={!showPassword} />
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.primaryBtnText, { fontFamily: 'Inter_600SemiBold' }]}>
              Create Account
            </Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
            Already have an account?
          </Text>
          <Pressable onPress={() => router.back()}>
            <Text style={[styles.footerLink, { fontFamily: 'Inter_600SemiBold' }]}>{' '}Sign in</Text>
          </Pressable>
        </View>
      </View>
      </ScrollView>
    </View>
  );
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function validateDob(dob: string): string {
  const parts = dob.split('/');
  if (parts.length !== 3) return 'Enter a complete date';
  const [dd, mm, yyyy] = parts;
  if (yyyy.length < 4) return 'Enter a 4-digit year';
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year = parseInt(yyyy, 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return 'Invalid date';
  if (month < 1 || month > 12) return 'Month must be between 01 and 12';
  const today = new Date();
  const currentYear = today.getFullYear();
  if (year < 1900 || year > currentYear) return `Year must be between 1900 and ${currentYear}`;
  const maxDays = getDaysInMonth(month, year);
  if (day < 1 || day > maxDays) {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${monthNames[month - 1]} ${year} only has ${maxDays} days`;
  }
  const entered = new Date(year, month - 1, day);
  if (entered > today) return 'Date of birth cannot be in the future';
  return '';
}

function DobField({ value, onChange, onError, C }: { value: string; onChange: (v: string) => void; onError: (e: string) => void; C: any }) {
  const [error, setError] = useState('');

  function handleChange(text: string) {
    // Extract only digits from whatever was typed
    const digits = text.replace(/\D/g, '').slice(0, 8);

    // Rebuild DD/MM/YYYY format from raw digits
    let formatted = digits;
    if (digits.length > 2) formatted = digits.slice(0, 2) + '/' + digits.slice(2);
    if (digits.length > 4) formatted = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);

    onChange(formatted);

    // Validate once the full date is entered
    if (digits.length === 8) {
      const err = validateDob(formatted);
      setError(err);
      onError(err);
    } else {
      setError('');
      onError('');
    }
  }

  const isValid = value.length === 10 && !error;

  return (
    <View>
      <Text style={[styles.label, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Date of Birth</Text>
      <View style={[styles.inputWrap, { backgroundColor: C.input, borderColor: error ? Colors.danger : isValid ? '#10B981' : C.inputBorder }]}>
        <Ionicons name="calendar-outline" size={18} color={error ? Colors.danger : C.textMuted} style={styles.inputIcon} />
        <TextInput
          style={[styles.input, { color: C.text, fontFamily: 'Inter_400Regular' }]}
          value={value}
          onChangeText={handleChange}
          placeholder="DD/MM/YYYY"
          placeholderTextColor={C.textMuted}
          keyboardType="numeric"
          maxLength={10}
        />
        {isValid && <Ionicons name="checkmark-circle" size={18} color="#10B981" />}
        {!!error && <Ionicons name="alert-circle" size={18} color={Colors.danger} />}
      </View>
      {!!error && (
        <Text style={{ color: Colors.danger, fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' }}>
          {error}
        </Text>
      )}
    </View>
  );
}

function Field({ label, icon, value, onChange, placeholder, C, keyboardType, autoCapitalize, secureTextEntry }: any) {
  return (
    <View>
      <Text style={[styles.label, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <View style={[styles.inputWrap, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
        <Ionicons name={icon} size={18} color={C.textMuted} style={styles.inputIcon} />
        <TextInput
          style={[styles.input, { color: C.text, fontFamily: 'Inter_400Regular' }]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          keyboardType={keyboardType || 'default'}
          autoCapitalize={autoCapitalize || 'words'}
          secureTextEntry={secureTextEntry || false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  scrollWeb: { alignItems: 'center' },
  inner: { width: '100%' },
  innerWeb: { maxWidth: 480 },
  backBtn: { marginBottom: 20, width: 40, height: 40, justifyContent: 'center' },
  title: { fontSize: 28, letterSpacing: -0.3 },
  sub: { fontSize: 14, marginTop: 4, marginBottom: 24 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  roleText: { fontSize: 15 },
  fields: { gap: 16, marginBottom: 24 },
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
  genderRow: { flexDirection: 'row', gap: 10 },
  genderBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  genderText: { fontSize: 13 },
  primaryBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  primaryBtnText: { color: '#fff', fontSize: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', paddingBottom: 8 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, color: Colors.primary },
});
