import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  useColorScheme, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { fetch } from 'expo/fetch';
import { useAuth } from '@/context/AuthContext';
import { useBLE } from '@/context/BLEContext';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';

type Activity = { title: string; description: string; duration: string };
type Category = { name: string; icon: string; color: string; activities: Activity[] };
type Suggestions = { summary: string; categories: Category[] };
type Prescription = {
  id: string; medicationName: string; dosage: string;
  frequency: string; times: string[]; notes: string;
  prescribedAt: string; doctorName?: string;
};

export default function ActivitiesScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader } = useAuth();
  const ble = useBLE();
  const base = getApiUrl();

  const WEB = Platform.OS === 'web';
  const topPad = WEB ? 67 : insets.top;
  const botPad = WEB ? 84 : insets.bottom;

  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastVitals, setLastVitals] = useState<any>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [rxLoading, setRxLoading] = useState(false);

  // Fetch prescriptions issued by care givers — read-only for patients
  async function fetchPrescriptions() {
    setRxLoading(true);
    try {
      const res = await fetch(`${base}api/patient/prescriptions`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        setPrescriptions(data.prescriptions ?? []);
      }
    } catch {}
    setRxLoading(false);
  }

  // Fetch latest stored vitals from server as a baseline
  async function fetchStoredVitals() {
    try {
      const res = await fetch(`${base}api/patient/vitals`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) setLastVitals(data[0]);
      }
    } catch {}
  }

  // Get the best available vitals — BLE live data takes priority over stored
  function getCurrentVitals() {
    if (ble.isConnected && ble.vitals) {
      const { systolicBP, diastolicBP } = ble.vitals;
      const bp = systolicBP != null && diastolicBP != null ? `${systolicBP}/${diastolicBP}` : undefined;
      return {
        heartRate: ble.vitals.heartRate,
        bloodPressure: bp,
        spo2: ble.vitals.spo2,
        temperature: ble.vitals.temperature,
      };
    }
    if (lastVitals) {
      return {
        heartRate: lastVitals.heartRate,
        bloodPressure: lastVitals.bloodPressure,
        spo2: lastVitals.spo2,
        temperature: lastVitals.temperature,
      };
    }
    return {};
  }

  async function fetchSuggestions() {
    setLoading(true);
    setError('');
    const vitals = getCurrentVitals();
    try {
      const res = await fetch(`${base}api/patient/activity-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(vitals),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to get suggestions');
      setSuggestions(data);
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong. Please try again.');
    }
    setLoading(false);
  }

  useFocusEffect(
    useCallback(() => {
      fetchPrescriptions();
      fetchStoredVitals().then(() => {
        if (!suggestions) fetchSuggestions();
      });
    }, [])
  );

  // Active vitals to show in the summary strip
  const vitals = getCurrentVitals();
  const hasVitals = Object.values(vitals).some(v => v != null && v !== undefined);

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: botPad + 24, paddingHorizontal: 16, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: C.text }]}>Activity Suggestions</Text>
            <Text style={[styles.subtitle, { color: C.textSub }]}>
              Personalised for your vitals today
            </Text>
          </View>
          <Pressable
            style={[styles.refreshBtn, { backgroundColor: Colors.primary + '18', borderColor: Colors.primary + '40' }]}
            onPress={fetchSuggestions}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Ionicons name="refresh" size={20} color={Colors.primary} />
            }
          </Pressable>
        </View>

        {/* BLE status pill */}
        <View style={[styles.statusPill, {
          backgroundColor: ble.isConnected ? Colors.secondary + '18' : C.card,
          borderColor: ble.isConnected ? Colors.secondary + '40' : C.cardBorder,
        }]}>
          <Ionicons
            name={ble.isConnected ? 'bluetooth' : 'bluetooth-outline'}
            size={14}
            color={ble.isConnected ? Colors.secondary : C.textMuted}
          />
          <Text style={[styles.statusText, { color: ble.isConnected ? Colors.secondary : C.textMuted }]}>
            {ble.isConnected ? `Live vitals from ${ble.deviceName ?? 'device'}` : 'Using last recorded vitals'}
          </Text>
        </View>

        {/* Vitals summary strip */}
        {hasVitals && (
          <View style={styles.vitalsRow}>
            {vitals.heartRate != null && (
              <VitalChip icon="heart" color={Colors.danger} label="HR" value={`${vitals.heartRate} bpm`} C={C} />
            )}
            {vitals.bloodPressure != null && (
              <VitalChip icon="pulse" color={Colors.primary} label="BP" value={String(vitals.bloodPressure)} C={C} />
            )}
            {vitals.spo2 != null && (
              <VitalChip icon="water" color="#06B6D4" label="SpO₂" value={`${vitals.spo2}%`} C={C} />
            )}
            {vitals.temperature != null && (
              <VitalChip icon="thermometer" color={Colors.warning} label="Temp" value={`${vitals.temperature}°C`} C={C} />
            )}
          </View>
        )}

        {/* Error state */}
        {error !== '' && (
          <View style={[styles.errorBox, { backgroundColor: Colors.danger + '12', borderColor: Colors.danger + '30' }]}>
            <Ionicons name="warning-outline" size={18} color={Colors.danger} />
            <Text style={[styles.errorText, { color: Colors.danger }]}>{error}</Text>
          </View>
        )}

        {/* Loading skeleton */}
        {loading && !suggestions && (
          <View style={{ gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <View key={i} style={[styles.skeletonCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <View style={[styles.skeletonLine, { width: 100, backgroundColor: C.divider }]} />
                <View style={[styles.skeletonLine, { width: '80%', backgroundColor: C.divider }]} />
                <View style={[styles.skeletonLine, { width: '60%', backgroundColor: C.divider }]} />
              </View>
            ))}
          </View>
        )}

        {/* AI summary banner */}
        {suggestions?.summary && !loading && (
          <View style={[styles.summaryBanner, { backgroundColor: Colors.primary + '12', borderColor: Colors.primary + '30' }]}>
            <Ionicons name="sparkles" size={18} color={Colors.primary} />
            <Text style={[styles.summaryText, { color: C.text }]}>{suggestions.summary}</Text>
          </View>
        )}

        {/* Category cards */}
        {!loading && suggestions?.categories?.map((cat, ci) => (
          <View key={ci} style={[styles.categoryCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {/* Category header */}
            <View style={[styles.categoryHeader, { backgroundColor: cat.color + '18' }]}>
              <View style={[styles.categoryIcon, { backgroundColor: cat.color + '25' }]}>
                <Ionicons name={cat.icon as any} size={20} color={cat.color} />
              </View>
              <Text style={[styles.categoryName, { color: cat.color }]}>{cat.name}</Text>
            </View>

            {/* Activities */}
            <View style={{ gap: 0 }}>
              {cat.activities.map((act, ai) => (
                <View
                  key={ai}
                  style={[
                    styles.activityRow,
                    ai < cat.activities.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.divider },
                  ]}
                >
                  <View style={[styles.activityDot, { backgroundColor: cat.color }]} />
                  <View style={styles.activityContent}>
                    <View style={styles.activityTitleRow}>
                      <Text style={[styles.activityTitle, { color: C.text }]}>{act.title}</Text>
                      <View style={[styles.durationBadge, { backgroundColor: cat.color + '18' }]}>
                        <Ionicons name="time-outline" size={10} color={cat.color} />
                        <Text style={[styles.durationText, { color: cat.color }]}>{act.duration}</Text>
                      </View>
                    </View>
                    <Text style={[styles.activityDesc, { color: C.textSub }]}>{act.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Empty state — first load prompt */}
        {!loading && !suggestions && error === '' && (
          <View style={[styles.emptyBox, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Ionicons name="sparkles-outline" size={40} color={Colors.primary} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>Get Activity Suggestions</Text>
            <Text style={[styles.emptyDesc, { color: C.textSub }]}>
              Tap refresh to get personalised activity ideas based on your current vitals.
            </Text>
            <Pressable style={[styles.getBtn, { backgroundColor: Colors.primary }]} onPress={fetchSuggestions}>
              <Text style={styles.getBtnText}>Get Suggestions</Text>
            </Pressable>
          </View>
        )}

        {/* ── My Prescriptions (read-only, issued by care giver) ── */}
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconWrap, { backgroundColor: Colors.purple + '18' }]}>
            <Ionicons name="medkit" size={16} color={Colors.purple} />
          </View>
          <Text style={[styles.sectionTitle, { color: C.text }]}>My Prescriptions</Text>
          <View style={[styles.caregiverBadge, { backgroundColor: Colors.purple + '14', borderColor: Colors.purple + '30' }]}>
            <Ionicons name="lock-closed" size={10} color={Colors.purple} />
            <Text style={[styles.caregiverBadgeText, { color: Colors.purple }]}>Care giver only</Text>
          </View>
        </View>

        {rxLoading && (
          <View style={[styles.rxLoadingBox, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <ActivityIndicator size="small" color={Colors.purple} />
            <Text style={[styles.rxLoadingText, { color: C.textSub }]}>Loading prescriptions…</Text>
          </View>
        )}

        {!rxLoading && prescriptions.length === 0 && (
          <View style={[styles.rxEmptyBox, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Ionicons name="medkit-outline" size={32} color={C.textMuted} />
            <Text style={[styles.rxEmptyTitle, { color: C.textSub }]}>No prescriptions yet</Text>
            <Text style={[styles.rxEmptyDesc, { color: C.textMuted }]}>
              When your care giver prescribes medication it will appear here.
            </Text>
          </View>
        )}

        {!rxLoading && prescriptions.map((rx, i) => (
          <View key={rx.id} style={[styles.rxCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            {/* Drug name + frequency */}
            <View style={styles.rxCardHeader}>
              <View style={[styles.rxPillIcon, { backgroundColor: Colors.purple + '18' }]}>
                <Ionicons name="medical" size={16} color={Colors.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rxName, { color: C.text }]}>{rx.medicationName}</Text>
                <Text style={[styles.rxDosage, { color: Colors.purple }]}>{rx.dosage} · {rx.frequency}</Text>
              </View>
            </View>

            {/* Scheduled times */}
            {rx.times?.length > 0 && (
              <View style={styles.rxTimesRow}>
                <Ionicons name="alarm-outline" size={13} color={C.textMuted} />
                <View style={styles.rxTimeChips}>
                  {rx.times.map((t, ti) => (
                    <View key={ti} style={[styles.rxTimeChip, { backgroundColor: Colors.purple + '14', borderColor: Colors.purple + '25' }]}>
                      <Text style={[styles.rxTimeText, { color: Colors.purple }]}>{t}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Notes */}
            {!!rx.notes && (
              <View style={[styles.rxNotesRow, { borderTopColor: C.divider }]}>
                <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
                <Text style={[styles.rxNotes, { color: C.textSub }]}>{rx.notes}</Text>
              </View>
            )}

            {/* Prescribed date */}
            <Text style={[styles.rxDate, { color: C.textMuted }]}>
              Prescribed {new Date(rx.prescribedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
        ))}

        {/* Footer note */}
        <Text style={[styles.footerNote, { color: C.textMuted }]}>
          ⚠️ Activity suggestions are for general wellness only. Take medications only as prescribed by your care giver.
        </Text>
      </ScrollView>
    </View>
  );
}

function VitalChip({ icon, color, label, value, C }: any) {
  return (
    <View style={[styles.vitalChip, { backgroundColor: color + '12', borderColor: color + '30' }]}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.vitalLabel, { color: C.textMuted }]}>{label}</Text>
      <Text style={[styles.vitalValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  refreshBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  vitalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vitalChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  vitalLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  vitalValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  summaryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1 },
  summaryText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  categoryCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  categoryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryName: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  activityDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  activityContent: { flex: 1, gap: 4 },
  activityTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activityTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },
  durationBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  durationText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  activityDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  skeletonCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  skeletonLine: { height: 12, borderRadius: 6 },
  emptyBox: { borderRadius: 16, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  getBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  getBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  footerNote: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', flex: 1 },
  caregiverBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  caregiverBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  rxLoadingBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 14, borderWidth: 1 },
  rxLoadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rxEmptyBox: { borderRadius: 14, borderWidth: 1, padding: 24, alignItems: 'center', gap: 8 },
  rxEmptyTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rxEmptyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
  rxCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  rxCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rxPillIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rxName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  rxDosage: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  rxTimesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  rxTimeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rxTimeChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  rxTimeText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  rxNotesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 12, paddingHorizontal: 14, borderTopWidth: 1 },
  rxNotes: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  rxDate: { fontSize: 11, fontFamily: 'Inter_400Regular', paddingHorizontal: 14, paddingBottom: 12, marginTop: -4 },
});
