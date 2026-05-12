import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme,
  Platform, Modal, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl } from '@/lib/query-client';

type RxRecord = {
  id: string;
  patientId: string;
  patientName: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  times: string[];
  notes: string;
  prescribedAt: string;
};

type Patient = { id: string; name: string; uniqueId: string };

const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times', 'Four times', 'As needed'];
const RX_TIMES = ['06:00', '08:00', '09:00', '12:00', '14:00', '18:00', '20:00', '22:00'];

const FREQUENCY_COUNT: Record<string, number> = {
  'Once daily': 1,
  'Twice daily': 2,
  'Three times': 3,
  'Four times': 4,
  'As needed': 1,
};
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function DoctorPrescriptionsScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader } = useAuth();

  const [prescriptions, setPrescriptions] = useState<RxRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<RxRecord | null>(null);

  // Prescribe modal steps: search → form
  const [showPrescribe, setShowPrescribe] = useState(false);
  const [step, setStep] = useState<'search' | 'form'>('search');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selPatient, setSelPatient] = useState<Patient | null>(null);

  // Prescription form fields
  const [rxMed, setRxMed] = useState('');
  const [rxDosage, setRxDosage] = useState('');
  const [rxFrequency, setRxFrequency] = useState(FREQUENCIES[0]);
  const [rxTimes, setRxTimes] = useState<string[]>(['08:00']);
  const [rxNotes, setRxNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const base = getApiUrl();

  async function loadPrescriptions() {
    try {
      const res = await fetch(`${base}api/doctor/prescriptions`, { headers: authHeader() });
      const data = await res.json();
      if (data.prescriptions) setPrescriptions(data.prescriptions);
    } catch {}
    setIsLoading(false);
  }

  useFocusEffect(useCallback(() => { loadPrescriptions(); }, []));

  async function searchPatients(q: string) {
    if (!q.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`${base}api/doctor/search?q=${encodeURIComponent(q)}`, { headers: authHeader() });
      const data = await res.json();
      setSearchResults(data.patients || []);
    } catch {}
    setIsSearching(false);
  }

  function openPrescribe() {
    setShowPrescribe(true);
    setStep('search');
    setSearchQ('');
    setSearchResults([]);
    setSelPatient(null);
    resetForm();
  }

  function resetForm() {
    setRxMed(''); setRxDosage(''); setRxFrequency(FREQUENCIES[0]);
    setRxTimes(['08:00']); setRxNotes('');
  }

  function selectPatient(p: Patient) {
    setSelPatient(p);
    setStep('form');
  }

  function toggleTime(t: string) {
    setRxTimes(prev => {
      if (prev.includes(t)) {
        return prev.length > 1 ? prev.filter(x => x !== t) : prev;
      }
      if (prev.length >= FREQUENCY_COUNT[rxFrequency]) return prev;
      return [...prev, t].sort();
    });
  }

  async function savePrescription() {
    if (!selPatient || !rxMed.trim() || !rxDosage.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${base}api/doctor/patient/${selPatient.id}/prescriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          medicationName: rxMed.trim(),
          dosage: rxDosage.trim(),
          frequency: rxFrequency,
          times: rxTimes,
          notes: rxNotes.trim(),
        }),
      });
      if (res.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadPrescriptions();
        setShowPrescribe(false);
      }
    } catch {}
    setIsSaving(false);
  }

  async function deletePrescription(rx: RxRecord) {
    try {
      await fetch(`${base}api/doctor/patient/${rx.patientId}/prescriptions/${rx.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await loadPrescriptions();
    } catch {}
    setDeleteTarget(null);
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};

  // Group prescriptions by patient
  const grouped = prescriptions.reduce<Record<string, RxRecord[]>>((acc, rx) => {
    if (!acc[rx.patientName]) acc[rx.patientName] = [];
    acc[rx.patientName].push(rx);
    return acc;
  }, {});

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.headerOuter, { paddingTop: topPad + 12, borderBottomColor: C.divider }]}>
        <View style={[styles.headerInner, webC]}>
          <Text style={[styles.headerTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Prescriptions</Text>
          <Pressable style={[styles.prescribeBtn, { backgroundColor: Colors.purple }]} onPress={openPrescribe}>
            <Ionicons name="add-circle-outline" size={17} color="#fff" />
            <Text style={[styles.prescribeBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Prescribe</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 100 }, WEB && { alignItems: 'center' }]} showsVerticalScrollIndicator={false}>
        <View style={[{ width: '100%', padding: 16, gap: 16 }, webC]}>
          {isLoading ? (
            <ActivityIndicator color={Colors.purple} style={{ marginTop: 40 }} />
          ) : prescriptions.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: Colors.purple + '15' }]}>
                <Ionicons name="document-text-outline" size={36} color={Colors.purple} />
              </View>
              <Text style={[styles.emptyTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>No prescriptions yet</Text>
              <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Tap Prescribe to issue a medication for any patient
              </Text>
              <Pressable style={[styles.emptyBtn, { backgroundColor: Colors.purple }]} onPress={openPrescribe}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={[styles.emptyBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Write Prescription</Text>
              </Pressable>
            </View>
          ) : (
            Object.entries(grouped).map(([patientName, rxList]) => (
              <View key={patientName}>
                <View style={styles.patientGroupHeader}>
                  <View style={[styles.patientInitialBadge, { backgroundColor: Colors.primary + '20' }]}>
                    <Text style={[styles.patientInitial, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
                      {patientName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.patientGroupName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>{patientName}</Text>
                  <View style={[styles.countPill, { backgroundColor: Colors.purple + '20' }]}>
                    <Text style={[styles.countPillText, { color: Colors.purple, fontFamily: 'Inter_600SemiBold' }]}>{rxList.length}</Text>
                  </View>
                </View>
                {rxList.map(rx => (
                  <RxCard key={rx.id} rx={rx} C={C} onDelete={() => setDeleteTarget(rx)} />
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Delete confirmation */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent>
        <View style={styles.overlayCenter}>
          <View style={[styles.confirmCard, { backgroundColor: C.card }]}>
            <View style={[styles.confirmIcon, { backgroundColor: Colors.danger + '15' }]}>
              <Ionicons name="trash-outline" size={26} color={Colors.danger} />
            </View>
            <Text style={[styles.confirmTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Remove Prescription</Text>
            <Text style={[styles.confirmSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              Remove {deleteTarget?.medicationName} from {deleteTarget?.patientName}'s prescriptions?
            </Text>
            <View style={styles.confirmBtns}>
              <Pressable style={[styles.confirmNo, { borderColor: C.cardBorder }]} onPress={() => setDeleteTarget(null)}>
                <Text style={[{ color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 15 }]}>Keep</Text>
              </Pressable>
              <Pressable style={[styles.confirmYes, { backgroundColor: Colors.danger }]} onPress={() => deleteTarget && deletePrescription(deleteTarget)}>
                <Text style={[{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 }]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Prescribe for patient modal */}
      <Modal visible={showPrescribe} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeaderRow}>
              {step === 'form' ? (
                <Pressable onPress={() => setStep('search')} style={styles.iconPress}>
                  <Ionicons name="chevron-back" size={20} color={C.text} />
                </Pressable>
              ) : <View style={{ width: 32 }} />}
              <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                {step === 'search' ? 'Find Patient' : 'Write Prescription'}
              </Text>
              <Pressable onPress={() => setShowPrescribe(false)} style={styles.iconPress}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </Pressable>
            </View>

            {step === 'search' ? (
              <View style={{ flex: 1 }}>
                <View style={[styles.searchBar, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                  <Ionicons name="search-outline" size={18} color={C.textMuted} />
                  <TextInput
                    style={[styles.searchInput, { color: C.text, fontFamily: 'Inter_400Regular' }]}
                    placeholder="Search by name or Patient ID (UMIN)..."
                    placeholderTextColor={C.textMuted}
                    value={searchQ}
                    onChangeText={q => { setSearchQ(q); searchPatients(q); }}
                    autoFocus
                  />
                  {isSearching && <ActivityIndicator size="small" color={Colors.purple} />}
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 20 }}>
                  {searchQ.length > 0 && !isSearching && searchResults.length === 0 && (
                    <View style={styles.searchEmpty}>
                      <Ionicons name="person-outline" size={40} color={C.textMuted} />
                      <Text style={[styles.searchEmptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                        No patient found for "{searchQ}"
                      </Text>
                    </View>
                  )}
                  {searchQ.length === 0 && (
                    <View style={styles.searchEmpty}>
                      <Ionicons name="person-circle-outline" size={48} color={C.textMuted} style={{ opacity: 0.4 }} />
                      <Text style={[styles.searchEmptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                        Enter patient name or UMIN to find them
                      </Text>
                    </View>
                  )}
                  {searchResults.map(p => (
                    <Pressable key={p.id}
                      style={({ pressed }) => [styles.patientItem, { backgroundColor: pressed ? Colors.purple + '12' : C.input, borderColor: C.cardBorder }]}
                      onPress={() => selectPatient(p)}
                    >
                      <View style={[styles.avatar, { backgroundColor: Colors.purple + '20' }]}>
                        <Text style={[styles.avatarText, { color: Colors.purple, fontFamily: 'Inter_700Bold' }]}>
                          {p.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 15, color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{p.name}</Text>
                        <Text style={[{ fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{p.uniqueId}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
                {/* Patient chip */}
                <View style={[styles.patientChip, { backgroundColor: Colors.purple + '12', borderColor: Colors.purple + '30' }]}>
                  <View style={[styles.avatar, { backgroundColor: Colors.purple + '25' }]}>
                    <Text style={[styles.avatarText, { color: Colors.purple, fontFamily: 'Inter_700Bold' }]}>
                      {selPatient?.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ fontSize: 15, color: Colors.purple, fontFamily: 'Inter_600SemiBold' }]}>{selPatient?.name}</Text>
                    <Text style={[{ fontSize: 12, color: Colors.purple + 'bb', fontFamily: 'Inter_400Regular' }]}>{selPatient?.uniqueId}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.purple} />
                </View>

                <FormField label="Medication Name *" value={rxMed} onChange={setRxMed} placeholder="e.g., Amoxicillin 500mg" C={C} />
                <FormField label="Dosage *" value={rxDosage} onChange={setRxDosage} placeholder="e.g., 1 tablet, 5ml" C={C} />

                <View>
                  <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Frequency</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                    {FREQUENCIES.map(f => (
                      <Pressable key={f}
                        style={[styles.chip, { backgroundColor: rxFrequency === f ? Colors.purple + '20' : C.input, borderColor: rxFrequency === f ? Colors.purple : C.inputBorder }]}
                        onPress={() => {
                          setRxFrequency(f);
                          setRxTimes(prev => prev.slice(0, FREQUENCY_COUNT[f]));
                        }}
                      >
                        <Text style={[styles.chipText, { color: rxFrequency === f ? Colors.purple : C.textSub, fontFamily: 'Inter_500Medium' }]}>{f}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium', marginBottom: 0 }]}>Reminder Times</Text>
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: rxTimes.length === FREQUENCY_COUNT[rxFrequency] ? Colors.secondary : Colors.purple }}>
                      {rxTimes.length} / {FREQUENCY_COUNT[rxFrequency]} selected
                    </Text>
                  </View>
                  <View style={styles.timesGrid}>
                    {RX_TIMES.map(t => {
                      const on = rxTimes.includes(t);
                      const slotIndex = rxTimes.indexOf(t);
                      const maxReached = rxTimes.length >= FREQUENCY_COUNT[rxFrequency];
                      const disabled = !on && maxReached;
                      return (
                        <Pressable key={t}
                          style={[styles.timeChip, {
                            backgroundColor: on ? Colors.purple + '20' : C.input,
                            borderColor: on ? Colors.purple : C.inputBorder,
                            opacity: disabled ? 0.4 : 1,
                            position: 'relative',
                          }]}
                          onPress={() => toggleTime(t)}
                          disabled={disabled}
                        >
                          {on && <Ionicons name="alarm" size={12} color={Colors.purple} />}
                          <Text style={[styles.chipText, { color: on ? Colors.purple : C.textSub, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
                          {on && (
                            <View style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.purple, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' }}>{slotIndex + 1}</Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <FormField label="Notes / Instructions" value={rxNotes} onChange={setRxNotes} placeholder="Take with food, avoid alcohol..." C={C} multiline />

                <View style={[styles.infoBox, { backgroundColor: Colors.secondary + '12', borderColor: Colors.secondary + '30' }]}>
                  <Ionicons name="notifications-outline" size={15} color={Colors.secondary} />
                  <Text style={[styles.infoText, { color: Colors.secondary, fontFamily: 'Inter_400Regular' }]}>
                    The patient will receive gentle in-app reminders 1 hour before each dose and at the scheduled time until they mark it as taken
                  </Text>
                </View>

                <View style={styles.formBtns}>
                  <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowPrescribe(false)}>
                    <Text style={[{ color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 15 }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, { backgroundColor: Colors.purple, opacity: (!rxMed.trim() || !rxDosage.trim() || isSaving) ? 0.6 : 1 }]}
                    onPress={savePrescription}
                    disabled={!rxMed.trim() || !rxDosage.trim() || isSaving}
                  >
                    {isSaving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={[{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 }]}>Issue Prescription</Text>
                    }
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RxCard({ rx, C, onDelete }: { rx: RxRecord; C: any; onDelete: () => void }) {
  return (
    <View style={[styles.rxCard, { backgroundColor: C.card, borderColor: Colors.purple + '35' }]}>
      <View style={[styles.rxBar, { backgroundColor: Colors.purple }]} />
      <View style={styles.rxBody}>
        <View style={styles.rxTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rxName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{rx.medicationName}</Text>
            <Text style={[styles.rxDosage, { color: Colors.purple, fontFamily: 'Inter_500Medium' }]}>{rx.dosage} · {rx.frequency}</Text>
          </View>
          <Pressable onPress={onDelete} style={styles.delBtn}>
            <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          </Pressable>
        </View>
        <View style={styles.timesRow}>
          {rx.times.map((t, i) => (
            <View key={i} style={[styles.timePill, { backgroundColor: Colors.purple + '18' }]}>
              <Ionicons name="alarm-outline" size={11} color={Colors.purple} />
              <Text style={[styles.timePillText, { color: Colors.purple, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
            </View>
          ))}
        </View>
        {rx.notes ? <Text style={[styles.rxNotes, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{rx.notes}</Text> : null}
        <Text style={[styles.rxDate, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>Prescribed {formatDate(rx.prescribedAt)}</Text>
      </View>
    </View>
  );
}

function FormField({ label, value, onChange, placeholder, C, multiline }: any) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text, fontFamily: 'Inter_400Regular', height: multiline ? 80 : 48, textAlignVertical: multiline ? 'top' : 'center' }]}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.textMuted} multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOuter: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingBottom: 14 },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 28, letterSpacing: -0.3 },
  prescribeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  prescribeBtnText: { color: '#fff', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  emptyBtnText: { color: '#fff', fontSize: 15 },
  patientGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  patientInitialBadge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  patientInitial: { fontSize: 14 },
  patientGroupName: { flex: 1, fontSize: 16 },
  countPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  countPillText: { fontSize: 12 },
  rxCard: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  rxBar: { width: 5 },
  rxBody: { flex: 1, padding: 14, gap: 8 },
  rxTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rxName: { fontSize: 16 },
  rxDosage: { fontSize: 13, marginTop: 2 },
  delBtn: { padding: 4 },
  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  timePillText: { fontSize: 12 },
  rxNotes: { fontSize: 12, fontStyle: 'italic' },
  rxDate: { fontSize: 11 },
  // Modals
  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  confirmCard: { width: '100%', borderRadius: 20, padding: 24, gap: 14, alignItems: 'center' },
  confirmIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { fontSize: 18 },
  confirmSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmNo: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  confirmYes: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc', alignSelf: 'center', marginBottom: 16 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  iconPress: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 18 },
  searchBar: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 10, gap: 10, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 15 },
  searchEmpty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  searchEmptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 260 },
  patientItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  patientChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16 },
  fieldLabel: { fontSize: 13, marginBottom: 8 },
  fieldInput: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 13 },
  timesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18 },
  formBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { flex: 2, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
