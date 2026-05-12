import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';

export default function DoctorProfile() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { user, logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  async function confirmLogout() {
    setShowLogoutModal(false);
    await logout();
    router.replace('/(auth)/login');
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[{ paddingTop: topPad + 12, paddingBottom: 100 }, WEB && { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
      <View style={webC}>
        <View style={styles.headerSection}>
          <View style={[styles.avatar, { backgroundColor: Colors.purple + '20', borderColor: Colors.purple + '40' }]}>
            <Text style={[styles.avatarText, { color: Colors.purple, fontFamily: 'Inter_700Bold' }]}>
              {user?.name?.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.userName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
            {user?.name}
          </Text>
          <View style={[styles.idBadge, { backgroundColor: Colors.purple + '20', borderColor: Colors.purple + '30' }]}>
            <Text style={[styles.idText, { color: Colors.purple, fontFamily: 'Inter_600SemiBold' }]}>{user?.uniqueId}</Text>
          </View>
          <Text style={[styles.roleText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>Care Giver</Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Account Information</Text>
          <InfoRow icon="mail-outline" label="Email" value={user?.email ?? '—'} C={C} />
          <InfoRow icon="call-outline" label="Phone" value={user?.phone ?? '—'} C={C} />
          <InfoRow icon="calendar-outline" label="Date of Birth" value={user?.dateOfBirth ?? '—'} C={C} />
          <InfoRow icon="person-outline" label="Gender" value={user?.gender ?? '—'} C={C} />
        </View>

        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>I-Sync Platform</Text>
          <View style={styles.featureList}>
            <FeatureRow icon="people-outline" label="Patient Search" sub="Search and access patient records by name or UMIN" color={Colors.primary} C={C} />
            <FeatureRow icon="pulse-outline" label="Live Vitals Monitoring" sub="View real-time patient vitals and trends" color={Colors.secondary} C={C} />
            <FeatureRow icon="flask-outline" label="Clinical AI Assistant" sub="Evidence-based medical decision support" color={Colors.purple} C={C} />
            <FeatureRow icon="document-text-outline" label="Activity Logging" sub="All profile changes are logged with timestamps" color={Colors.warning} C={C} />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Privacy & Compliance</Text>
          <View style={[styles.complianceBox, { backgroundColor: Colors.secondary + '12', borderColor: Colors.secondary + '30' }]}>
            <Ionicons name="shield-checkmark" size={20} color={Colors.secondary} />
            <Text style={[styles.complianceText, { color: Colors.secondary, fontFamily: 'Inter_400Regular' }]}>
              All patient data access is logged and monitored. I-Sync maintains audit trails for regulatory compliance.
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.logoutBtn, { borderColor: Colors.danger + '40', opacity: pressed ? 0.8 : 1 }]}
          onPress={() => setShowLogoutModal(true)}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={[styles.logoutText, { color: Colors.danger, fontFamily: 'Inter_600SemiBold' }]}>Sign Out</Text>
        </Pressable>
      </View>
      </ScrollView>

      <Modal visible={showLogoutModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: C.card }]}>
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.danger + '15', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="log-out-outline" size={26} color={Colors.danger} />
              </View>
              <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Sign Out</Text>
              <Text style={[styles.modalSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                Are you sure you want to sign out of your account?
              </Text>
            </View>
            <View style={styles.modalBtns}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowLogoutModal(false)}>
                <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, { backgroundColor: Colors.danger }]} onPress={confirmLogout}>
                <Text style={[styles.confirmText, { fontFamily: 'Inter_600SemiBold' }]}>Sign Out</Text>
              </Pressable>
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

function FeatureRow({ icon, label, sub, color, C }: any) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.featureInfo}>
        <Text style={[styles.featureLabel, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{label}</Text>
        <Text style={[styles.featureSub, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{sub}</Text>
      </View>
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
  card: { marginHorizontal: 20, marginBottom: 12, borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  sectionTitle: { fontSize: 15, marginBottom: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  infoLabel: { fontSize: 13, width: 100 },
  infoValue: { flex: 1, fontSize: 14 },
  featureList: { gap: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  featureIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureInfo: { flex: 1, gap: 2 },
  featureLabel: { fontSize: 14 },
  featureSub: { fontSize: 12, lineHeight: 18 },
  complianceBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  complianceText: { flex: 1, fontSize: 13, lineHeight: 20 },
  logoutBtn: { marginHorizontal: 20, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14, borderWidth: 1.5 },
  logoutText: { fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  modalCard: { width: '100%', borderRadius: 20, padding: 28, gap: 20 },
  modalTitle: { fontSize: 20, textAlign: 'center' },
  modalSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
  confirmBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: '#fff', fontSize: 15 },
});
