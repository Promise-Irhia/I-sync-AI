import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme,
  Platform, TextInput, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { fetch } from 'expo/fetch';
import { useFocusEffect } from 'expo-router';

type Patient = {
  id: string;
  name: string;
  uniqueId: string;
  email: string;
  phone?: string;
  gender?: string;
  dateOfBirth?: string;
};

export default function DoctorDashboard() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { user, authHeader } = useAuth();
  const base = getApiUrl();

  const [searchQuery, setSearchQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [myPatients, setMyPatients] = useState<Patient[]>([]);
  const [myPatientIds, setMyPatientIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  // Load the care giver's personal patient list whenever this screen gains focus
  useFocusEffect(useCallback(() => {
    loadMyPatients();
  }, []));

  async function loadMyPatients() {
    try {
      const res = await fetch(`${base}api/doctor/my-patients`, { headers: authHeader() });
      const data = await res.json();
      const list: Patient[] = data.patients || [];
      setMyPatients(list);
      setMyPatientIds(new Set(list.map(p => p.id)));
    } catch {}
  }

  async function searchPatients(q: string) {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const res = await fetch(`${base}api/doctor/search?q=${encodeURIComponent(q)}`, {
        headers: authHeader(),
      });
      const data = await res.json();
      setPatients(data.patients || []);
    } catch {
      setPatients([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function togglePatientCare(patient: Patient) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAddingId(patient.id);
    const isAdded = myPatientIds.has(patient.id);

    try {
      if (isAdded) {
        await fetch(`${base}api/doctor/my-patients/${patient.id}`, {
          method: 'DELETE',
          headers: authHeader(),
        });
        setMyPatients(prev => prev.filter(p => p.id !== patient.id));
        setMyPatientIds(prev => { const s = new Set(prev); s.delete(patient.id); return s; });
      } else {
        await fetch(`${base}api/doctor/my-patients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ patientId: patient.id }),
        });
        setMyPatients(prev => [patient, ...prev]);
        setMyPatientIds(prev => new Set([...prev, patient.id]));
      }
    } catch {}

    setAddingId(null);
  }

  function handlePatientPress(patient: Patient) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/(doctor)/patient/[id]', params: { id: patient.id } });
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={[styles.headerOuter, { paddingTop: topPad + 12 }]}>
        <View style={[styles.headerInner, webC]}>
          <View>
            <Text style={[styles.greeting, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>Care Giver Portal</Text>
            <Text style={[styles.userName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
              {user?.name?.split(' ').slice(-1)[0]}
            </Text>
          </View>
          <View style={[styles.idBadge, { backgroundColor: Colors.purple + '20', borderColor: Colors.purple + '40' }]}>
            <Text style={[styles.idText, { color: Colors.purple, fontFamily: 'Inter_600SemiBold' }]}>{user?.uniqueId}</Text>
          </View>
        </View>
      </View>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <View style={[styles.searchOuter, { paddingBottom: 16 }]}>
        <View style={[styles.searchInner, webC]}>
          <View style={[styles.searchBox, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
            <Ionicons name="search-outline" size={18} color={C.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: C.text, fontFamily: 'Inter_400Regular' }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by patient name or UMIN..."
              placeholderTextColor={C.textMuted}
              returnKeyType="search"
              onSubmitEditing={() => searchPatients(searchQuery)}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => { setSearchQuery(''); setPatients([]); setHasSearched(false); }}>
                <Ionicons name="close-circle" size={18} color={C.textMuted} />
              </Pressable>
            )}
          </View>
          <Pressable style={[styles.searchBtn, { backgroundColor: Colors.primary }]} onPress={() => searchPatients(searchQuery)}>
            <Ionicons name="search" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[{ paddingHorizontal: 20, paddingBottom: 100 }, WEB && { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={webC}>

          {/* ── My Patients section ─────────────────────────────────────────── */}
          {myPatients.length > 0 && (
            <View style={styles.myPatientsSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="heart-circle-outline" size={18} color={Colors.primary} />
                <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                  My Care List
                </Text>
                <View style={[styles.countBadge, { backgroundColor: Colors.primary + '20' }]}>
                  <Text style={[styles.countText, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                    {myPatients.length}
                  </Text>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.myPatientsScroll}>
                {myPatients.map(p => (
                  <MyCareCard
                    key={p.id}
                    patient={p}
                    C={C}
                    onPress={() => handlePatientPress(p)}
                    onRemove={() => togglePatientCare(p)}
                    removing={addingId === p.id}
                  />
                ))}
              </ScrollView>

              <View style={[styles.divider, { backgroundColor: C.divider }]} />
            </View>
          )}

          {/* ── Search results / welcome ─────────────────────────────────────── */}
          {!hasSearched ? (
            <View style={styles.welcomeWrap}>
              <View style={[styles.welcomeIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Ionicons name="people-outline" size={44} color={Colors.primary} />
              </View>
              <Text style={[styles.welcomeTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                Search Patients
              </Text>
              <Text style={[styles.welcomeSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                Search by patient name or Medical ID (UMIN) to access their health records and live vitals.
              </Text>
              <View style={[styles.tipCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
                <Text style={[styles.tipText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                  Tip: Search with an empty query to see all registered patients.
                </Text>
              </View>
            </View>
          ) : isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : patients.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="person-outline" size={56} color={C.textMuted} />
              <Text style={[styles.emptyTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>No patients found</Text>
              <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>Try searching with a different name or ID</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.resultsLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>
                {patients.length} patient{patients.length !== 1 ? 's' : ''} found
              </Text>
              {patients.map(patient => (
                <PatientCard
                  key={patient.id}
                  patient={patient}
                  C={C}
                  onPress={() => handlePatientPress(patient)}
                  isAdded={myPatientIds.has(patient.id)}
                  isLoading={addingId === patient.id}
                  onToggleCare={() => togglePatientCare(patient)}
                />
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── My Care horizontal card ────────────────────────────────────────────────────

function MyCareCard({
  patient, C, onPress, onRemove, removing,
}: {
  patient: Patient; C: any; onPress: () => void; onRemove: () => void; removing: boolean;
}) {
  const initials = patient.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#06B6D4', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'];
  const color = colors[patient.name.charCodeAt(0) % colors.length];

  return (
    <Pressable style={({ pressed }) => [styles.myCareCard, { backgroundColor: C.card, borderColor: C.cardBorder, opacity: pressed ? 0.85 : 1 }]} onPress={onPress}>
      <View style={[styles.myCareAvatar, { backgroundColor: color + '20' }]}>
        <Text style={[styles.myCareInitials, { color, fontFamily: 'Inter_700Bold' }]}>{initials}</Text>
      </View>
      <Text style={[styles.myCareName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>{patient.name}</Text>
      <Text style={[styles.myCareId, { color: Colors.primary, fontFamily: 'Inter_500Medium' }]}>{patient.uniqueId}</Text>
      <Pressable
        style={[styles.myCareRemove, { backgroundColor: Colors.danger + '15' }]}
        onPress={onRemove}
        disabled={removing}
        hitSlop={8}
      >
        {removing
          ? <ActivityIndicator size={10} color={Colors.danger} />
          : <Ionicons name="close" size={12} color={Colors.danger} />
        }
      </Pressable>
    </Pressable>
  );
}

// ── Search result patient card ────────────────────────────────────────────────

function PatientCard({
  patient, C, onPress, isAdded, isLoading, onToggleCare,
}: {
  patient: Patient; C: any; onPress: () => void;
  isAdded: boolean; isLoading: boolean; onToggleCare: () => void;
}) {
  const initials = patient.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#06B6D4', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'];
  const color = colors[patient.name.charCodeAt(0) % colors.length];

  return (
    <Pressable
      style={({ pressed }) => [
        styles.patientCard,
        { backgroundColor: C.card, borderColor: isAdded ? Colors.primary + '50' : C.cardBorder, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
      onPress={onPress}
    >
      <View style={[styles.patientAvatar, { backgroundColor: color + '20' }]}>
        <Text style={[styles.patientInitials, { color, fontFamily: 'Inter_700Bold' }]}>{initials}</Text>
      </View>
      <View style={styles.patientInfo}>
        <Text style={[styles.patientName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{patient.name}</Text>
        <Text style={[styles.patientId, { color: Colors.primary, fontFamily: 'Inter_500Medium' }]}>{patient.uniqueId}</Text>
        <View style={styles.patientMeta}>
          {patient.gender && (
            <Text style={[styles.patientMetaText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{patient.gender}</Text>
          )}
          {patient.dateOfBirth && (
            <Text style={[styles.patientMetaText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>· {patient.dateOfBirth}</Text>
          )}
        </View>
      </View>

      {/* Add / Remove from My Care button */}
      <Pressable
        style={[
          styles.addCareBtn,
          { backgroundColor: isAdded ? Colors.primary + '15' : Colors.primary, borderWidth: 0 },
        ]}
        onPress={e => { e.stopPropagation(); onToggleCare(); }}
        disabled={isLoading}
        hitSlop={8}
      >
        {isLoading ? (
          <ActivityIndicator size={14} color={isAdded ? Colors.primary : '#fff'} />
        ) : isAdded ? (
          <Ionicons name="checkmark" size={14} color={Colors.primary} />
        ) : (
          <Ionicons name="add" size={14} color="#fff" />
        )}
      </Pressable>

      <Ionicons name="chevron-forward" size={18} color={C.textMuted} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOuter: { paddingHorizontal: 20, paddingBottom: 12 },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchOuter: { paddingHorizontal: 20 },
  searchInner: { flexDirection: 'row', gap: 10 },
  greeting: { fontSize: 13, marginBottom: 2 },
  userName: { fontSize: 24, letterSpacing: -0.3 },
  idBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  idText: { fontSize: 12 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 48, gap: 10 },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  searchBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  // My Patients section
  myPatientsSection: { marginBottom: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 12 },
  myPatientsScroll: { marginHorizontal: -20, paddingHorizontal: 20 },
  divider: { height: 1, marginTop: 20, marginBottom: 16 },

  // My Care compact card (horizontal scroll)
  myCareCard: { width: 110, borderRadius: 14, borderWidth: 1, padding: 12, marginRight: 10, alignItems: 'center', gap: 6, position: 'relative' },
  myCareAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  myCareInitials: { fontSize: 15 },
  myCareName: { fontSize: 12, textAlign: 'center' },
  myCareId: { fontSize: 10, textAlign: 'center' },
  myCareRemove: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  // Welcome / empty states
  welcomeWrap: { paddingTop: 40, alignItems: 'center', gap: 16 },
  welcomeIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: { fontSize: 22, letterSpacing: -0.3 },
  welcomeSub: { fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  tipCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, width: '100%' },
  tipText: { flex: 1, fontSize: 13, lineHeight: 20 },
  loadingWrap: { paddingTop: 60, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  resultsLabel: { fontSize: 12, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },

  // Search result patient card
  patientCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 14 },
  patientAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  patientInitials: { fontSize: 16 },
  patientInfo: { flex: 1, gap: 2 },
  patientName: { fontSize: 16 },
  patientId: { fontSize: 12 },
  patientMeta: { flexDirection: 'row', gap: 4, marginTop: 2 },
  patientMetaText: { fontSize: 12 },
  addCareBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
