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

type Appointment = {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  date: string;
  time: string;
  specialty: string;
  notes: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
};

type Patient = { id: string; name: string; uniqueId: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SPECIALTIES = ['General', 'Cardiology', 'Neurology', 'Endocrinology', 'Pulmonology', 'Orthopedics', 'Other'];
const TIMES = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];

export default function DoctorAppointmentsScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader } = useAuth();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState('');

  // Cancel confirmation modal
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);

  // Schedule for patient modal
  const [showSchedule, setShowSchedule] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState(TIMES[2]);
  const [schedSpecialty, setSchedSpecialty] = useState(SPECIALTIES[0]);
  const [schedNotes, setSchedNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [schedStep, setSchedStep] = useState<'search' | 'form'>('search');

  const base = getApiUrl();

  async function loadAppointments() {
    try {
      const res = await fetch(`${base}api/doctor/appointments`, { headers: authHeader() });
      const data = await res.json();
      if (data.appointments) setAppointments(data.appointments);
    } catch {}
    setIsLoading(false);
  }

  useFocusEffect(useCallback(() => { loadAppointments(); }, []));

  const datesWithAppts = new Set(appointments.map(a => a.date));

  function getCalendarDays() {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }

  function makeDateStr(year: number, month: number, day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function formatDate(iso: string) {
    const [y, m, d] = iso.split('-');
    return `${d} ${SHORT_MONTHS[parseInt(m) - 1]} ${y}`;
  }

  function isToday(day: number) {
    return calYear === today.getFullYear() && calMonth === today.getMonth() && day === today.getDate();
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  async function updateStatus(id: string, status: 'confirmed' | 'cancelled') {
    setUpdatingId(id);
    try {
      await fetch(`${base}api/doctor/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ status }),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadAppointments();
    } catch {}
    setUpdatingId(null);
  }

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

  function openSchedule() {
    setShowSchedule(true);
    setSchedStep('search');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPatient(null);
    setSchedDate(selectedDate || '');
    setSchedTime(TIMES[2]);
    setSchedSpecialty(SPECIALTIES[0]);
    setSchedNotes('');
  }

  function selectPatient(p: Patient) {
    setSelectedPatient(p);
    setSchedStep('form');
  }

  async function scheduleAppointment() {
    if (!selectedPatient || !schedDate || !schedTime) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${base}api/doctor/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          date: schedDate,
          time: schedTime,
          specialty: schedSpecialty,
          notes: schedNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { return; }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadAppointments();
      setShowSchedule(false);
      setSelectedDate(schedDate);
    } catch {}
    setIsSaving(false);
  }

  const calDays = getCalendarDays();
  const selectedAppts = selectedDate ? appointments.filter(a => a.date === selectedDate) : [];
  const upcoming = appointments.filter(a => new Date(`${a.date}T${a.time}`) >= new Date() && a.status !== 'cancelled');
  const pending = upcoming.filter(a => a.status === 'pending');
  const confirmed = upcoming.filter(a => a.status === 'confirmed');
  const past = appointments.filter(a => new Date(`${a.date}T${a.time}`) < new Date());

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};
  const statusColor = (s: string) => s === 'confirmed' ? Colors.secondary : s === 'cancelled' ? Colors.danger : Colors.warning;

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.headerOuter, { paddingTop: topPad + 12, borderBottomColor: C.divider }]}>
        <View style={[styles.headerInner, webC]}>
          <Text style={[styles.headerTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Schedule</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {pending.length > 0 && (
              <View style={[styles.pendingBadge, { backgroundColor: Colors.warning }]}>
                <Text style={[styles.pendingBadgeText, { fontFamily: 'Inter_700Bold' }]}>{pending.length}</Text>
              </View>
            )}
            <Pressable style={[styles.schedBtn, { backgroundColor: Colors.primary }]} onPress={openSchedule}>
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={[styles.schedBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Schedule</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 100 }, WEB && { alignItems: 'center' }]} showsVerticalScrollIndicator={false}>
      <View style={[{ width: '100%' }, webC]}>

        {/* Calendar */}
        <View style={[styles.calCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={styles.calHeader}>
            <Pressable onPress={prevMonth} style={styles.calNavBtn}>
              <Ionicons name="chevron-back" size={20} color={C.text} />
            </Pressable>
            <Text style={[styles.calMonthTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
              {MONTHS[calMonth]} {calYear}
            </Text>
            <Pressable onPress={nextMonth} style={styles.calNavBtn}>
              <Ionicons name="chevron-forward" size={20} color={C.text} />
            </Pressable>
          </View>

          <View style={styles.calDayLabels}>
            {DAYS.map(d => (
              <Text key={d} style={[styles.calDayLabel, { color: C.textMuted, fontFamily: 'Inter_600SemiBold' }]}>{d}</Text>
            ))}
          </View>

          <View style={styles.calGrid}>
            {calDays.map((day, idx) => {
              if (!day) return <View key={idx} style={styles.calCell} />;
              const dateStr = makeDateStr(calYear, calMonth, day);
              const hasAppt = datesWithAppts.has(dateStr);
              const isSelected = selectedDate === dateStr;
              const todayDay = isToday(day);
              return (
                <Pressable
                  key={idx}
                  style={[
                    styles.calCell,
                    isSelected && { backgroundColor: Colors.primary, borderRadius: 20 },
                    todayDay && !isSelected && { borderWidth: 1.5, borderRadius: 20, borderColor: Colors.primary },
                  ]}
                  onPress={() => setSelectedDate(isSelected ? '' : dateStr)}
                >
                  <Text style={[styles.calDayNum, { color: isSelected ? '#fff' : C.text, fontFamily: isSelected || todayDay ? 'Inter_700Bold' : 'Inter_400Regular' }]}>
                    {day}
                  </Text>
                  {hasAppt && <View style={[styles.calDot, { backgroundColor: isSelected ? '#fff' : Colors.primary }]} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Selected date */}
            {selectedDate !== '' && (
              <View style={styles.section}>
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>
                    {formatDate(selectedDate)}
                  </Text>
                  <Pressable
                    style={[styles.miniScheduleBtn, { backgroundColor: Colors.primary + '18', borderColor: Colors.primary + '40' }]}
                    onPress={() => { setSchedDate(selectedDate); openSchedule(); }}
                  >
                    <Ionicons name="add" size={14} color={Colors.primary} />
                    <Text style={[styles.miniScheduleText, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Add</Text>
                  </Pressable>
                </View>
                {selectedAppts.length === 0 ? (
                  <View style={[styles.emptyDayCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                    <Text style={[{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13 }]}>No appointments on this day</Text>
                  </View>
                ) : (
                  selectedAppts.map(a => (
                    <ApptCard key={a.id} appt={a} C={C} statusColor={statusColor} updatingId={updatingId}
                      onConfirm={() => updateStatus(a.id, 'confirmed')}
                      onCancel={() => setCancelTarget(a)} />
                  ))
                )}
              </View>
            )}

            {/* Pending */}
            {pending.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionTitle, { color: Colors.warning, fontFamily: 'Inter_600SemiBold' }]}>Awaiting Confirmation</Text>
                  <View style={[styles.countBadge, { backgroundColor: Colors.warning + '20' }]}>
                    <Text style={[styles.countText, { color: Colors.warning, fontFamily: 'Inter_700Bold' }]}>{pending.length}</Text>
                  </View>
                </View>
                {pending.map(a => (
                  <ApptCard key={a.id} appt={a} C={C} statusColor={statusColor} updatingId={updatingId}
                    onConfirm={() => updateStatus(a.id, 'confirmed')}
                    onCancel={() => setCancelTarget(a)} />
                ))}
              </View>
            )}

            {/* Confirmed upcoming */}
            {confirmed.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: Colors.secondary, fontFamily: 'Inter_600SemiBold' }]}>Confirmed</Text>
                {confirmed.map(a => (
                  <ApptCard key={a.id} appt={a} C={C} statusColor={statusColor} updatingId={updatingId}
                    onConfirm={() => {}}
                    onCancel={() => setCancelTarget(a)} />
                ))}
              </View>
            )}

            {/* Past */}
            {past.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: C.textMuted, fontFamily: 'Inter_600SemiBold' }]}>Past</Text>
                {past.map(a => (
                  <View key={a.id} style={[styles.apptCard, { backgroundColor: C.card, borderColor: C.cardBorder, opacity: 0.6 }]}>
                    {renderApptContent(a, C, statusColor)}
                  </View>
                ))}
              </View>
            )}

            {appointments.length === 0 && !selectedDate && (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: Colors.primary + '15' }]}>
                  <Ionicons name="calendar-outline" size={36} color={Colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>No appointments yet</Text>
                <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                  Use the Schedule button to book an appointment for a patient
                </Text>
                <Pressable style={[styles.emptyBtn, { backgroundColor: Colors.primary }]} onPress={openSchedule}>
                  <Ionicons name="person-add-outline" size={18} color="#fff" />
                  <Text style={[styles.emptyBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Schedule for Patient</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>
      </ScrollView>

      {/* Cancel confirmation modal */}
      <Modal visible={!!cancelTarget} animationType="fade" transparent>
        <View style={styles.overlayCenter}>
          <View style={[styles.confirmCard, { backgroundColor: C.card }]}>
            <View style={[styles.confirmIcon, { backgroundColor: Colors.danger + '15' }]}>
              <Ionicons name="close-circle-outline" size={28} color={Colors.danger} />
            </View>
            <Text style={[styles.confirmTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Cancel Appointment</Text>
            <Text style={[styles.confirmSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              Cancel {cancelTarget?.patientName}'s appointment on {cancelTarget ? formatDate(cancelTarget.date) : ''}?
            </Text>
            <View style={styles.confirmBtns}>
              <Pressable style={[styles.confirmNo, { borderColor: C.cardBorder }]} onPress={() => setCancelTarget(null)}>
                <Text style={[styles.confirmNoText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Keep</Text>
              </Pressable>
              <Pressable style={[styles.confirmYes, { backgroundColor: Colors.danger }]} onPress={async () => {
                if (cancelTarget) { await updateStatus(cancelTarget.id, 'cancelled'); setCancelTarget(null); }
              }}>
                <Text style={[styles.confirmYesText, { fontFamily: 'Inter_600SemiBold' }]}>Cancel Appt</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Schedule for Patient modal */}
      <Modal visible={showSchedule} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />

            {/* Header row */}
            <View style={styles.modalHeaderRow}>
              {schedStep === 'form' ? (
                <Pressable onPress={() => setSchedStep('search')} style={styles.backBtn}>
                  <Ionicons name="chevron-back" size={20} color={C.text} />
                </Pressable>
              ) : <View style={{ width: 32 }} />}
              <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                {schedStep === 'search' ? 'Find Patient' : 'Schedule Appointment'}
              </Text>
              <Pressable onPress={() => setShowSchedule(false)} style={styles.backBtn}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </Pressable>
            </View>

            {schedStep === 'search' ? (
              /* ─── STEP 1: Search patient ─── */
              <View style={{ flex: 1 }}>
                <View style={[styles.searchBar, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                  <Ionicons name="search-outline" size={18} color={C.textMuted} />
                  <TextInput
                    style={[styles.searchInput, { color: C.text, fontFamily: 'Inter_400Regular' }]}
                    placeholder="Search by name or Patient ID (UMIN)..."
                    placeholderTextColor={C.textMuted}
                    value={searchQuery}
                    onChangeText={q => { setSearchQuery(q); searchPatients(q); }}
                    autoFocus
                  />
                  {isSearching && <ActivityIndicator size="small" color={Colors.primary} />}
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 20 }}>
                  {searchResults.length === 0 && searchQuery.length > 0 && !isSearching && (
                    <View style={styles.noResults}>
                      <Ionicons name="person-outline" size={40} color={C.textMuted} />
                      <Text style={[styles.noResultsText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                        No patient found for "{searchQuery}"
                      </Text>
                    </View>
                  )}
                  {searchResults.length === 0 && searchQuery.length === 0 && (
                    <View style={styles.searchHint}>
                      <Ionicons name="person-circle-outline" size={48} color={C.textMuted} style={{ opacity: 0.5 }} />
                      <Text style={[styles.searchHintText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                        Enter a patient name or their unique ID to find them
                      </Text>
                    </View>
                  )}
                  {searchResults.map(p => (
                    <Pressable
                      key={p.id}
                      style={({ pressed }) => [styles.patientItem, { backgroundColor: pressed ? Colors.primary + '12' : C.input, borderColor: C.cardBorder }]}
                      onPress={() => selectPatient(p)}
                    >
                      <View style={[styles.patientAvatar, { backgroundColor: Colors.primary + '20' }]}>
                        <Text style={[styles.patientAvatarText, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
                          {p.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.patientName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{p.name}</Text>
                        <Text style={[styles.patientId, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{p.uniqueId}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : (
              /* ─── STEP 2: Fill appointment details ─── */
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>

                {/* Selected patient chip */}
                <View style={[styles.patientChip, { backgroundColor: Colors.primary + '15', borderColor: Colors.primary + '35' }]}>
                  <View style={[styles.patientAvatar, { backgroundColor: Colors.primary + '25' }]}>
                    <Text style={[styles.patientAvatarText, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
                      {selectedPatient?.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.patientName, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{selectedPatient?.name}</Text>
                    <Text style={[styles.patientId, { color: Colors.primary + 'bb', fontFamily: 'Inter_400Regular' }]}>{selectedPatient?.uniqueId}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                </View>

                {/* Date */}
                <View>
                  <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Date *</Text>
                  <Pressable
                    style={[styles.datePickBtn, { backgroundColor: C.input, borderColor: schedDate ? Colors.primary : C.inputBorder }]}
                    onPress={() => {
                      setShowSchedule(false);
                    }}
                  >
                    <Ionicons name="calendar-outline" size={18} color={schedDate ? Colors.primary : C.textMuted} />
                    <Text style={[{ flex: 1, fontSize: 15, fontFamily: schedDate ? 'Inter_500Medium' : 'Inter_400Regular' }, { color: schedDate ? C.text : C.textMuted }]}>
                      {schedDate ? formatDate(schedDate) : 'Pick date from calendar first'}
                    </Text>
                  </Pressable>
                  {!schedDate && (
                    <Text style={[styles.hintText, { color: Colors.warning, fontFamily: 'Inter_400Regular' }]}>
                      Close this form, tap a date on the calendar, then tap Schedule again
                    </Text>
                  )}
                </View>

                {/* Time */}
                <View>
                  <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Time *</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                    {TIMES.map(t => (
                      <Pressable key={t}
                        style={[styles.chip, { backgroundColor: schedTime === t ? Colors.primary + '20' : C.input, borderColor: schedTime === t ? Colors.primary : C.inputBorder }]}
                        onPress={() => setSchedTime(t)}
                      >
                        <Text style={[styles.chipText, { color: schedTime === t ? Colors.primary : C.textSub, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                {/* Specialty */}
                <View>
                  <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Specialty</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                    {SPECIALTIES.map(s => (
                      <Pressable key={s}
                        style={[styles.chip, { backgroundColor: schedSpecialty === s ? Colors.primary + '20' : C.input, borderColor: schedSpecialty === s ? Colors.primary : C.inputBorder }]}
                        onPress={() => setSchedSpecialty(s)}
                      >
                        <Text style={[styles.chipText, { color: schedSpecialty === s ? Colors.primary : C.textSub, fontFamily: 'Inter_500Medium' }]}>{s}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                {/* Notes */}
                <View>
                  <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Notes (optional)</Text>
                  <TextInput
                    style={[styles.notesInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text, fontFamily: 'Inter_400Regular' }]}
                    value={schedNotes}
                    onChangeText={setSchedNotes}
                    placeholder="Reason for visit, symptoms, instructions..."
                    placeholderTextColor={C.textMuted}
                    multiline
                  />
                </View>

                {/* Auto-confirmed note */}
                <View style={[styles.infoBox, { backgroundColor: Colors.secondary + '12', borderColor: Colors.secondary + '30' }]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={Colors.secondary} />
                  <Text style={[styles.infoText, { color: Colors.secondary, fontFamily: 'Inter_400Regular' }]}>
                    Care giver-scheduled appointments are automatically confirmed and appear on the patient's calendar immediately
                  </Text>
                </View>

                <View style={styles.modalBtns}>
                  <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowSchedule(false)}>
                    <Text style={[styles.cancelBtnText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, { backgroundColor: Colors.primary, opacity: (!schedDate || isSaving) ? 0.6 : 1 }]}
                    onPress={scheduleAppointment}
                    disabled={!schedDate || isSaving}
                  >
                    {isSaving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={[styles.saveBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Confirm Appointment</Text>
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

function renderApptContent(appt: Appointment, C: any, statusColor: (s: string) => string) {
  const [y, m, d] = appt.date.split('-');
  const sc = statusColor(appt.status);
  return (
    <>
      <View style={[styles.apptDateBox, { backgroundColor: Colors.primary + '18' }]}>
        <Text style={[styles.apptDay, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>{d}</Text>
        <Text style={[styles.apptMonth, { color: Colors.primary, fontFamily: 'Inter_500Medium' }]}>{SHORT_MONTHS[parseInt(m) - 1] ?? '---'}</Text>
      </View>
      <View style={styles.apptInfo}>
        <Text style={[styles.apptName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{appt.patientName}</Text>
        <Text style={[styles.apptSpec, { color: Colors.primary, fontFamily: 'Inter_500Medium' }]}>{appt.specialty}</Text>
        <View style={styles.apptMetaRow}>
          <Ionicons name="time-outline" size={12} color={C.textMuted} />
          <Text style={[styles.apptMeta, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{appt.time}</Text>
          <View style={[styles.statusBadge, { backgroundColor: sc + '20' }]}>
            <Text style={[styles.statusText, { color: sc, fontFamily: 'Inter_500Medium' }]}>
              {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
            </Text>
          </View>
        </View>
      </View>
    </>
  );
}

function ApptCard({ appt, C, statusColor, updatingId, onConfirm, onCancel }: any) {
  const isUpdating = updatingId === appt.id;
  return (
    <View style={[styles.apptCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
      {renderApptContent(appt, C, statusColor)}
      {appt.status === 'pending' && !isUpdating && (
        <View style={styles.actionBtns}>
          <Pressable style={[styles.iconBtn, { backgroundColor: Colors.secondary + '20', borderColor: Colors.secondary + '40' }]} onPress={onConfirm}>
            <Ionicons name="checkmark" size={18} color={Colors.secondary} />
          </Pressable>
          <Pressable style={[styles.iconBtn, { backgroundColor: Colors.danger + '15', borderColor: Colors.danger + '30' }]} onPress={onCancel}>
            <Ionicons name="close" size={18} color={Colors.danger} />
          </Pressable>
        </View>
      )}
      {appt.status === 'confirmed' && !isUpdating && (
        <Pressable style={[styles.iconBtn, { backgroundColor: Colors.danger + '15', borderColor: Colors.danger + '30' }]} onPress={onCancel}>
          <Ionicons name="close" size={18} color={Colors.danger} />
        </Pressable>
      )}
      {isUpdating && <ActivityIndicator size="small" color={Colors.primary} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOuter: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingBottom: 14 },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 28, letterSpacing: -0.3 },
  pendingBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pendingBadgeText: { color: '#fff', fontSize: 11 },
  schedBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  schedBtnText: { color: '#fff', fontSize: 14 },
  calCard: { margin: 16, borderRadius: 20, borderWidth: 1, padding: 16 },
  calHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  calNavBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calMonthTitle: { fontSize: 17 },
  calDayLabels: { flexDirection: 'row', marginBottom: 8 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 11 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  calDayNum: { fontSize: 14 },
  calDot: { width: 5, height: 5, borderRadius: 3, marginTop: 1 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  miniScheduleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  miniScheduleText: { fontSize: 12 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  countText: { fontSize: 12 },
  emptyDayCard: { borderRadius: 14, borderWidth: 1, padding: 16, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  emptyBtnText: { color: '#fff', fontSize: 15 },
  apptCard: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center', gap: 12, marginBottom: 10 },
  apptDateBox: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  apptDay: { fontSize: 20, lineHeight: 22 },
  apptMonth: { fontSize: 11 },
  apptInfo: { flex: 1, gap: 3 },
  apptName: { fontSize: 15 },
  apptSpec: { fontSize: 12 },
  apptMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  apptMeta: { fontSize: 12 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 11 },
  actionBtns: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // Modals
  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  confirmCard: { width: '100%', borderRadius: 20, padding: 24, gap: 14, alignItems: 'center' },
  confirmIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { fontSize: 18 },
  confirmSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmNo: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  confirmNoText: { fontSize: 15 },
  confirmYes: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmYesText: { color: '#fff', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc', alignSelf: 'center', marginBottom: 16 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 18 },
  searchBar: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 10, gap: 10, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 15 },
  noResults: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  noResultsText: { fontSize: 14, textAlign: 'center' },
  searchHint: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  searchHintText: { fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 260 },
  patientItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  patientChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  patientAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  patientAvatarText: { fontSize: 16 },
  patientName: { fontSize: 15 },
  patientId: { fontSize: 12, marginTop: 1 },
  fieldLabel: { fontSize: 13, marginBottom: 8 },
  datePickBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  hintText: { fontSize: 12, marginTop: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 13 },
  notesInput: { borderRadius: 12, borderWidth: 1.5, padding: 14, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 15 },
  saveBtn: { flex: 2, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontSize: 15 },
});
