import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme,
  Platform, Alert, TextInput, Switch, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { fetch } from 'expo/fetch';
import QRCode from 'react-native-qrcode-svg';

type EmergencyContact = { name: string; phone: string; relation: string };

export default function PatientProfile() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { user, token, logout, authHeader } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [showEditEC, setShowEditEC] = useState(false);
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecRelation, setEcRelation] = useState('');
  const [activityLog, setActivityLog] = useState<any[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPairing, setShowPairing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [profileRes, logRes] = await Promise.all([
        fetch(`${getApiUrl()}api/patient/profile`, { headers: authHeader() }),
        fetch(`${getApiUrl()}api/patient/activity-log`, { headers: authHeader() }),
      ]);
      const profileData = await profileRes.json();
      const logData = await logRes.json();
      if (profileData.profile) setProfile(profileData.profile);
      if (logData.log) setActivityLog(logData.log);

      const ecData = await AsyncStorage.getItem('isync_emergency_contacts');
      if (ecData) setEmergencyContacts(JSON.parse(ecData));
    } catch {}
  }

  async function addEmergencyContact() {
    if (!ecName.trim() || !ecPhone.trim()) {
      Alert.alert('Missing Info', 'Please enter name and phone number.');
      return;
    }
    const newContacts = [...emergencyContacts, { name: ecName.trim(), phone: ecPhone.trim(), relation: ecRelation.trim() }];
    setEmergencyContacts(newContacts);
    await AsyncStorage.setItem('isync_emergency_contacts', JSON.stringify(newContacts));
    setEcName(''); setEcPhone(''); setEcRelation('');
    setShowEditEC(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function removeEmergencyContact(index: number) {
    const newContacts = emergencyContacts.filter((_, i) => i !== index);
    setEmergencyContacts(newContacts);
    await AsyncStorage.setItem('isync_emergency_contacts', JSON.stringify(newContacts));
  }

  function handleLogout() {
    setShowLogoutModal(true);
  }

  async function confirmLogout() {
    setShowLogoutModal(false);
    await logout();
    router.replace('/(auth)/login');
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' as const } : {};

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[{ paddingTop: topPad + 12, paddingBottom: 100 }, WEB && { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
      <View style={webC}>
        <View style={styles.headerSection}>
          <View style={[styles.avatar, { backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '40' }]}>
            <Text style={[styles.avatarText, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
              {user?.name?.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.userName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>{user?.name}</Text>
          <View style={[styles.idBadge, { backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '30' }]}>
            <Text style={[styles.idText, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{user?.uniqueId}</Text>
          </View>
          <Text style={[styles.roleText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>Patient</Text>
        </View>

        <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Personal Information</Text>
          <InfoRow icon="mail-outline" label="Email" value={user?.email ?? '—'} C={C} />
          <InfoRow icon="call-outline" label="Phone" value={user?.phone ?? '—'} C={C} />
          <InfoRow icon="calendar-outline" label="Date of Birth" value={user?.dateOfBirth ?? '—'} C={C} />
          <InfoRow icon="person-outline" label="Gender" value={user?.gender ?? '—'} C={C} />
          {profile?.bloodType && <InfoRow icon="water-outline" label="Blood Type" value={profile.bloodType} C={C} />}
          {profile?.weight && <InfoRow icon="fitness-outline" label="Weight" value={`${profile.weight} kg`} C={C} />}
          {profile?.height && <InfoRow icon="resize-outline" label="Height" value={`${profile.height} cm`} C={C} />}
        </View>

        <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <Pressable style={styles.sectionHeader} onPress={() => setShowPairing(!showPairing)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="hardware-chip-outline" size={17} color={Colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold', marginBottom: 0 }]}>Device Pairing</Text>
            </View>
            <Ionicons name={showPairing ? 'chevron-up' : 'chevron-down'} size={20} color={C.textMuted} />
          </Pressable>

          {showPairing && (
            <View style={{ marginTop: 14, gap: 16 }}>
              <View style={{ alignItems: 'center', gap: 12 }}>
                <View style={{ padding: 12, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.cardBorder }}>
                  <QRCode
                    value={user?.uniqueId ?? 'unknown'}
                    size={160}
                    color="#000"
                    backgroundColor="#fff"
                  />
                </View>
                <Text style={[styles.pairIdLabel, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                  Scan with your ESP32 camera module
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[{ color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 13 }]}>Option A — QR Scan (recommended)</Text>
                <Text style={[{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 }]}>
                  Point your ESP32 camera at the QR code above. The device will call{' '}
                  <Text style={{ fontFamily: 'Inter_500Medium', color: C.text }}>POST /pair</Text> to verify, then save your ID to its flash memory automatically.
                </Text>
              </View>

              <View style={[styles.pairIdBox, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                <Text style={[{ color: C.textMuted, fontFamily: 'Inter_500Medium', fontSize: 11, marginBottom: 4 }]}>Option B — Hardcode in firmware</Text>
                <Text style={[{ color: Colors.primary, fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: 1.5 }]}>{user?.uniqueId}</Text>
                <Text style={[{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 }]}>
                  Copy this ID into your ESP32 sketch before flashing
                </Text>
              </View>

              <View style={[{ borderRadius: 10, padding: 12, backgroundColor: Colors.warning + '14', gap: 4 }]}>
                <Text style={[{ color: Colors.warning, fontFamily: 'Inter_600SemiBold', fontSize: 12 }]}>ESP32 Boot Flow</Text>
                <Text style={[{ color: C.textSub, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 }]}>
                  On startup the ESP32 reads its stored ID and calls{' '}
                  <Text style={{ fontFamily: 'Inter_500Medium', color: C.text }}>POST /pair {'{'} patientId {'}'}</Text>.
                  If valid it begins sending vitals. If invalid it halts and flashes an error LED.
                </Text>
              </View>
            </View>
          )}
        </View>

        {(profile?.allergies?.length > 0 || profile?.conditions?.length > 0) && (
          <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Medical Info</Text>
            {profile.allergies?.length > 0 && (
              <View style={styles.tagSection}>
                <Text style={[styles.tagLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Allergies</Text>
                <View style={styles.tagRow}>
                  {profile.allergies.map((a: string, i: number) => (
                    <View key={i} style={[styles.tag, { backgroundColor: Colors.danger + '18' }]}>
                      <Text style={[styles.tagText, { color: Colors.danger, fontFamily: 'Inter_500Medium' }]}>{a}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {profile.conditions?.length > 0 && (
              <View style={styles.tagSection}>
                <Text style={[styles.tagLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Conditions</Text>
                <View style={styles.tagRow}>
                  {profile.conditions.map((c: string, i: number) => (
                    <View key={i} style={[styles.tag, { backgroundColor: Colors.warning + '18' }]}>
                      <Text style={[styles.tagText, { color: Colors.warning, fontFamily: 'Inter_500Medium' }]}>{c}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Emergency Contacts</Text>
            <Pressable onPress={() => setShowEditEC(true)}>
              <Ionicons name="add-circle" size={24} color={Colors.primary} />
            </Pressable>
          </View>
          {emergencyContacts.length === 0 ? (
            <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>No emergency contacts added</Text>
          ) : (
            emergencyContacts.map((ec, i) => (
              <View key={i} style={[styles.ecRow, { borderBottomColor: C.divider }]}>
                <View style={[styles.ecAvatar, { backgroundColor: Colors.secondary + '20' }]}>
                  <Ionicons name="person" size={16} color={Colors.secondary} />
                </View>
                <View style={styles.ecInfo}>
                  <Text style={[styles.ecName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{ec.name}</Text>
                  <Text style={[styles.ecMeta, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>{ec.relation} · {ec.phone}</Text>
                </View>
                <Pressable onPress={() => removeEmergencyContact(i)}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </Pressable>
              </View>
            ))
          )}
        </View>

        {activityLog.length > 0 && (
          <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Pressable style={styles.sectionHeader} onPress={() => setShowLog(!showLog)}>
              <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Medical Activity Log</Text>
              <Ionicons name={showLog ? 'chevron-up' : 'chevron-down'} size={20} color={C.textMuted} />
            </Pressable>
            {showLog && activityLog.slice(0, 5).map((entry, i) => (
              <View key={i} style={[styles.logEntry, { borderBottomColor: C.divider }]}>
                <View style={styles.logHeader}>
                  <Text style={[styles.logDoctor, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{entry.doctorName}</Text>
                  <Text style={[styles.logTime, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{new Date(entry.timestamp).toLocaleDateString()}</Text>
                </View>
                <Text style={[styles.logDetail, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                  Updated <Text style={{ fontFamily: 'Inter_600SemiBold', color: C.text }}>{entry.field}</Text>: {entry.previousValue} → {entry.newValue}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.logoutBtn, { borderColor: Colors.danger + '40', opacity: pressed ? 0.8 : 1 }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={[styles.logoutText, { color: Colors.danger, fontFamily: 'Inter_600SemiBold' }]}>Sign Out</Text>
        </Pressable>
      </View>
      </ScrollView>

      <Modal visible={showLogoutModal} animationType="fade" transparent>
        <View style={[styles.modalOverlay, { justifyContent: 'center', paddingHorizontal: 32 }]}>
          <View style={[styles.modalSheet, { borderRadius: 20, padding: 28, gap: 20 }]}>
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.danger + '15', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="log-out-outline" size={26} color={Colors.danger} />
              </View>
              <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold', textAlign: 'center' }]}>Sign Out</Text>
              <Text style={{ color: C.textSub, fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                Are you sure you want to sign out of your account?
              </Text>
            </View>
            <View style={styles.modalBtns}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowLogoutModal(false)}>
                <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, { backgroundColor: Colors.danger }]} onPress={confirmLogout}>
                <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Sign Out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showEditEC} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Add Emergency Contact</Text>
            <View style={{ gap: 14 }}>
              <FormField label="Name *" value={ecName} onChange={setEcName} placeholder="John Doe" C={C} />
              <FormField label="Phone *" value={ecPhone} onChange={setEcPhone} placeholder="+1 234 567 8900" C={C} keyboardType="phone-pad" />
              <FormField label="Relation" value={ecRelation} onChange={setEcRelation} placeholder="Spouse / Parent / Friend" C={C} />
              <View style={styles.modalBtns}>
                <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowEditEC(false)}>
                  <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.saveBtn} onPress={addEmergencyContact}>
                  <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Add</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({ icon, label, value, C }: any) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: C.divider }]}>
      <Ionicons name={icon} size={16} color={C.textMuted} />
      <Text style={[styles.infoLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: C.text, fontFamily: 'Inter_400Regular' }]}>{value}</Text>
    </View>
  );
}

function FormField({ label, value, onChange, placeholder, C, keyboardType }: any) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text, fontFamily: 'Inter_400Regular' }]}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.textMuted}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerSection: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  avatarText: { fontSize: 32 },
  userName: { fontSize: 22, letterSpacing: -0.3 },
  idBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  idText: { fontSize: 13 },
  roleText: { fontSize: 13 },
  infoCard: { marginHorizontal: 20, marginBottom: 12, borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  sectionTitle: { fontSize: 15, marginBottom: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  infoLabel: { fontSize: 13, width: 100 },
  infoValue: { flex: 1, fontSize: 14 },
  tagSection: { marginBottom: 8 },
  tagLabel: { fontSize: 13, marginBottom: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 12 },
  emptyText: { fontSize: 13, paddingVertical: 8 },
  ecRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  ecAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  ecInfo: { flex: 1 },
  ecName: { fontSize: 14 },
  ecMeta: { fontSize: 12, marginTop: 1 },
  logEntry: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  logDoctor: { fontSize: 13 },
  logTime: { fontSize: 12 },
  logDetail: { fontSize: 13, lineHeight: 20 },
  pairIdLabel: { fontSize: 12, textAlign: 'center' },
  pairIdBox: { borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center' },
  logoutBtn: { marginHorizontal: 20, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14, borderWidth: 1.5 },
  logoutText: { fontSize: 16 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc', alignSelf: 'center' },
  modalTitle: { fontSize: 22 },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  fieldInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 48, fontSize: 15 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
  saveBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontSize: 15 },
});
