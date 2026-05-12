import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme,
  Platform, Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
let Notifications: typeof import('expo-notifications') | null = null;
try {
  if (Platform.OS !== 'web') {
    Notifications = require('expo-notifications');
  }
} catch {}
let Calendar: typeof import('expo-calendar') | null = null;
try {
  if (Platform.OS !== 'web') {
    Calendar = require('expo-calendar');
  }
} catch {}
import { Colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl } from '@/lib/query-client';

type Doctor = { id: string; name: string; uniqueId: string };
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
  notificationIds?: string[];
};

const SPECIALTIES = ['General', 'Cardiology', 'Neurology', 'Endocrinology', 'Pulmonology', 'Orthopedics', 'Other'];
const TIMES = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AppointmentsScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader } = useAuth();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState('');

  const [selDoctor, setSelDoctor] = useState<Doctor | null>(null);
  const [selSpecialty, setSelSpecialty] = useState(SPECIALTIES[0]);
  const [selTime, setSelTime] = useState(TIMES[2]);
  const [notes, setNotes] = useState('');
  const [showDoctorPick, setShowDoctorPick] = useState(false);

  const base = getApiUrl();

  async function loadData() {
    try {
      const [apptRes, docRes] = await Promise.all([
        fetch(`${base}api/patient/appointments`, { headers: authHeader() }),
        fetch(`${base}api/doctors`, { headers: authHeader() }),
      ]);
      const apptData = await apptRes.json();
      const docData = await docRes.json();
      if (apptData.appointments) setAppointments(apptData.appointments);
      if (docData.doctors) setDoctors(docData.doctors);
    } catch {}
    setIsLoading(false);
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

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
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  }

  function formatDisplayDate(isoDate: string) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    return `${d} ${SHORT_MONTHS[parseInt(m) - 1]} ${y}`;
  }

  function isToday(day: number) {
    return calYear === today.getFullYear() && calMonth === today.getMonth() && day === today.getDate();
  }

  function isPastDay(day: number) {
    const d = new Date(calYear, calMonth, day);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return d < t;
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  async function scheduleNotif(apptDate: string, apptTime: string, doctorName: string): Promise<string[]> {
    if (Platform.OS === 'web' || !Notifications) return [];
    const [y, m, d] = apptDate.split('-').map(Number);
    const [hour, minute] = apptTime.split(':').map(Number);
    const apptMs = new Date(y, m - 1, d, hour, minute).getTime();
    const ids: string[] = [];
    const offsets = [24 * 60, 60, 15];
    const labels = ['24 hours', '1 hour', '15 minutes'];
    for (let i = 0; i < offsets.length; i++) {
      const remind = new Date(apptMs - offsets[i] * 60 * 1000);
      if (remind > new Date()) {
        const id = await Notifications.scheduleNotificationAsync({
          content: { title: 'Appointment Reminder', body: `Your appointment with ${doctorName} is in ${labels[i]}.` },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: remind },
        });
        ids.push(id);
      }
    }
    return ids;
  }

  async function addToCalendar(appt: Appointment) {
    if (Platform.OS === 'web' || !Calendar) return;
    try {
      const { status } = await Calendar!.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Calendar access is needed to add this appointment.');
        return;
      }
      const calendars = await Calendar!.getCalendarsAsync(Calendar!.EntityTypes.EVENT);
      const writable = calendars.find(c => c.allowsModifications);
      if (!writable) {
        Alert.alert('No Calendar', 'No writable calendar found on this device.');
        return;
      }
      const [y, m, d] = appt.date.split('-').map(Number);
      const [hour, minute] = appt.time.split(':').map(Number);
      const startDate = new Date(y, m - 1, d, hour, minute);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      await Calendar!.createEventAsync(writable.id, {
        title: `Appointment with ${appt.doctorName}`,
        startDate,
        endDate,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes: appt.notes || `Specialty: ${appt.specialty}`,
        alarms: [{ relativeOffset: -60 }, { relativeOffset: -15 }],
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Added to Calendar', `${appt.doctorName} on ${appt.date} at ${appt.time} has been saved to your calendar.`);
    } catch (e) {
      Alert.alert('Error', 'Could not add to calendar.');
    }
  }

  async function bookAppointment() {
    if (!selDoctor || !selectedDate) {
      Alert.alert('Missing Info', 'Please select a care giver and a date.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${base}api/patient/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          doctorId: selDoctor.id,
          doctorName: selDoctor.name,
          date: selectedDate,
          time: selTime,
          specialty: selSpecialty,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert('Error', data.error || 'Failed to book'); return; }

      await scheduleNotif(selectedDate, selTime, selDoctor.name);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadData();
      setSelDoctor(null); setSelSpecialty(SPECIALTIES[0]); setSelTime(TIMES[2]); setNotes(''); setSelectedDate('');
      setShowAdd(false);
    } catch {
      Alert.alert('Error', 'Could not book appointment');
    }
    setIsSaving(false);
  }

  async function cancelAppointment(id: string) {
    await fetch(`${base}api/patient/appointments/${id}`, { method: 'DELETE', headers: authHeader() });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await loadData();
  }

  const calDays = getCalendarDays();
  const selectedAppts = selectedDate ? appointments.filter(a => a.date === selectedDate) : [];
  const upcoming = appointments.filter(a => new Date(`${a.date}T${a.time}`) >= new Date());
  const past = appointments.filter(a => new Date(`${a.date}T${a.time}`) < new Date());

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};

  const statusColor = (s: string) => s === 'confirmed' ? Colors.secondary : s === 'cancelled' ? Colors.danger : Colors.warning;
  const statusLabel = (s: string) => s === 'confirmed' ? 'Confirmed' : s === 'cancelled' ? 'Cancelled' : 'Pending';

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.headerOuter, { paddingTop: topPad + 12, borderBottomColor: C.divider }]}>
        <View style={[styles.headerInner, webC]}>
          <Text style={[styles.headerTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Appointments</Text>
          <Pressable style={[styles.addBtn, { backgroundColor: Colors.primary }]} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
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
              const isPast = isPastDay(day);
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
                  <Text style={[
                    styles.calDayNum,
                    { color: isSelected ? '#fff' : isPast ? C.textMuted : C.text, fontFamily: isSelected || todayDay ? 'Inter_700Bold' : 'Inter_400Regular' },
                  ]}>
                    {day}
                  </Text>
                  {hasAppt && (
                    <View style={[styles.calDot, { backgroundColor: isSelected ? '#fff' : Colors.primary }]} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Selected date appointments */}
        {selectedDate !== '' && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>
              {formatDisplayDate(selectedDate)}
            </Text>
            {selectedAppts.length === 0 ? (
              <View style={[styles.dayEmptyCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <Text style={[styles.dayEmptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>No appointments on this day</Text>
                <Pressable style={[styles.bookNowBtn, { backgroundColor: Colors.primary + '18', borderColor: Colors.primary + '40' }]} onPress={() => setShowAdd(true)}>
                  <Text style={[styles.bookNowText, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Book Now</Text>
                </Pressable>
              </View>
            ) : (
              selectedAppts.map(a => (
                <ApptCard key={a.id} appt={a} C={C} statusColor={statusColor} statusLabel={statusLabel}
                  onCalendar={() => addToCalendar(a)}
                  onDelete={() => Alert.alert('Cancel Appointment', `Cancel appointment with ${a.doctorName}?`, [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Cancel Appointment', style: 'destructive', onPress: () => cancelAppointment(a.id) },
                  ])} />
              ))
            )}
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {upcoming.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Upcoming</Text>
                {upcoming.map(a => (
                  <ApptCard key={a.id} appt={a} C={C} statusColor={statusColor} statusLabel={statusLabel}
                    onCalendar={() => addToCalendar(a)}
                    onDelete={() => Alert.alert('Cancel', `Cancel appointment with ${a.doctorName}?`, [
                      { text: 'Keep', style: 'cancel' },
                      { text: 'Cancel', style: 'destructive', onPress: () => cancelAppointment(a.id) },
                    ])} />
                ))}
              </View>
            )}
            {past.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: C.textMuted, fontFamily: 'Inter_600SemiBold' }]}>Past</Text>
                {past.map(a => (
                  <ApptCard key={a.id} appt={a} C={C} statusColor={statusColor} statusLabel={statusLabel} isPast
                    onDelete={() => cancelAppointment(a.id)} />
                ))}
              </View>
            )}
            {appointments.length === 0 && !selectedDate && (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={56} color={C.textMuted} />
                <Text style={[styles.emptyTitle, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>No appointments yet</Text>
                <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>Tap + to book with a care giver</Text>
              </View>
            )}
          </>
        )}
      </View>
      </ScrollView>

      {/* Book Appointment Modal */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Book Appointment</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>

              {/* Doctor selection */}
              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Care Giver *</Text>
                <Pressable
                  style={[styles.doctorPickBtn, { backgroundColor: C.input, borderColor: selDoctor ? Colors.primary : C.inputBorder }]}
                  onPress={() => setShowDoctorPick(true)}
                >
                  {selDoctor ? (
                    <View style={styles.doctorPickContent}>
                      <View style={[styles.docAvatarSmall, { backgroundColor: Colors.primary + '20' }]}>
                        <Text style={[styles.docAvatarText, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
                          {selDoctor.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <Text style={[styles.doctorPickName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{selDoctor.name}</Text>
                        <Text style={[styles.doctorPickId, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{selDoctor.uniqueId}</Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={[styles.doctorPickPlaceholder, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                      Select a care giver...
                    </Text>
                  )}
                  <Ionicons name="chevron-down" size={16} color={C.textMuted} />
                </Pressable>
              </View>

              {/* Date — show selected or prompt to pick from calendar */}
              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Date *</Text>
                <Pressable
                  style={[styles.doctorPickBtn, { backgroundColor: C.input, borderColor: selectedDate ? Colors.primary : C.inputBorder }]}
                  onPress={() => setShowAdd(false)}
                >
                  <Text style={[{ flex: 1, fontSize: 15, fontFamily: selectedDate ? 'Inter_500Medium' : 'Inter_400Regular' }, { color: selectedDate ? C.text : C.textMuted }]}>
                    {selectedDate ? formatDisplayDate(selectedDate) : 'Pick date from calendar first'}
                  </Text>
                  <Ionicons name="calendar-outline" size={16} color={C.textMuted} />
                </Pressable>
                {!selectedDate && (
                  <Text style={[styles.hintText, { color: Colors.primary, fontFamily: 'Inter_400Regular' }]}>
                    ↑ Close this form, tap a date on the calendar, then tap +
                  </Text>
                )}
              </View>

              {/* Specialty */}
              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Specialty</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {SPECIALTIES.map(s => (
                    <Pressable key={s}
                      style={[styles.chipBtn, { backgroundColor: selSpecialty === s ? Colors.primary + '20' : C.input, borderColor: selSpecialty === s ? Colors.primary : C.inputBorder }]}
                      onPress={() => setSelSpecialty(s)}
                    >
                      <Text style={[styles.chipText, { color: selSpecialty === s ? Colors.primary : C.textSub, fontFamily: 'Inter_500Medium' }]}>{s}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Time */}
              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Preferred Time</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {TIMES.map(t => (
                    <Pressable key={t}
                      style={[styles.chipBtn, { backgroundColor: selTime === t ? Colors.primary + '20' : C.input, borderColor: selTime === t ? Colors.primary : C.inputBorder }]}
                      onPress={() => setSelTime(t)}
                    >
                      <Text style={[styles.chipText, { color: selTime === t ? Colors.primary : C.textSub, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Notes */}
              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Notes (optional)</Text>
                <TextInput
                  style={[styles.notesInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text, fontFamily: 'Inter_400Regular' }]}
                  value={notes} onChangeText={setNotes}
                  placeholder="Reason for visit, symptoms..."
                  placeholderTextColor={C.textMuted} multiline
                />
              </View>

              {Platform.OS !== 'web' && (
                <View style={[styles.reminderInfo, { backgroundColor: Colors.primary + '12', borderColor: Colors.primary + '30' }]}>
                  <Ionicons name="notifications-outline" size={16} color={Colors.primary} />
                  <Text style={[styles.reminderText, { color: Colors.primary, fontFamily: 'Inter_400Regular' }]}>
                    Reminders will be sent 24h, 1h, and 15min before
                  </Text>
                </View>
              )}

              <View style={styles.modalBtns}>
                <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowAdd(false)}>
                  <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.saveBtn, { opacity: isSaving ? 0.7 : 1 }]} onPress={bookAppointment} disabled={isSaving}>
                  {isSaving ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Book Appointment</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Doctor picker modal */}
      <Modal visible={showDoctorPick} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Select Care Giver</Text>
            {doctors.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}>
                <Ionicons name="person-outline" size={48} color={C.textMuted} />
                <Text style={[{ color: C.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center' }]}>
                  No care givers registered yet. Ask your care giver to create an account on I-Sync.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
                {doctors.map(doc => (
                  <Pressable key={doc.id}
                    style={[styles.docPickItem, { backgroundColor: selDoctor?.id === doc.id ? Colors.primary + '15' : C.input, borderColor: selDoctor?.id === doc.id ? Colors.primary : C.cardBorder }]}
                    onPress={() => { setSelDoctor(doc); setShowDoctorPick(false); }}
                  >
                    <View style={[styles.docAvatarSmall, { backgroundColor: Colors.primary + '20' }]}>
                      <Text style={[styles.docAvatarText, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
                        {doc.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[{ fontSize: 15, color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{doc.name}</Text>
                      <Text style={[{ fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{doc.uniqueId}</Text>
                    </View>
                    {selDoctor?.id === doc.id && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder, marginTop: 8 }]} onPress={() => setShowDoctorPick(false)}>
              <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ApptCard({ appt, C, isPast, onDelete, onCalendar, statusColor, statusLabel }: any) {
  const [y, m, d] = appt.date.split('-');
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = SHORT_MONTHS[parseInt(m) - 1] ?? '---';
  const sc = statusColor(appt.status);
  return (
    <View style={[styles.apptCard, { backgroundColor: C.card, borderColor: C.cardBorder, opacity: isPast ? 0.65 : 1 }]}>
      <View style={[styles.apptDateBox, { backgroundColor: isPast ? C.input : Colors.primary + '18' }]}>
        <Text style={[styles.apptDay, { color: isPast ? C.textMuted : Colors.primary, fontFamily: 'Inter_700Bold' }]}>{d}</Text>
        <Text style={[styles.apptMonth, { color: isPast ? C.textMuted : Colors.primary, fontFamily: 'Inter_500Medium' }]}>{monthName}</Text>
      </View>
      <View style={styles.apptInfo}>
        <Text style={[styles.apptDoctor, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{appt.doctorName}</Text>
        <Text style={[styles.apptSpec, { color: Colors.primary, fontFamily: 'Inter_500Medium' }]}>{appt.specialty}</Text>
        <View style={styles.apptMetaRow}>
          <Ionicons name="time-outline" size={13} color={C.textMuted} />
          <Text style={[styles.apptMeta, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{appt.time}</Text>
          <View style={[styles.statusBadge, { backgroundColor: sc + '20' }]}>
            <Text style={[styles.statusText, { color: sc, fontFamily: 'Inter_500Medium' }]}>{statusLabel(appt.status)}</Text>
          </View>
        </View>
        {appt.notes ? <Text style={[styles.apptNotes, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>{appt.notes}</Text> : null}
        {!isPast && onCalendar && Platform.OS !== 'web' && (
          <Pressable onPress={onCalendar} style={[styles.calendarBtn, { backgroundColor: Colors.primary + '15', borderColor: Colors.primary + '30' }]}>
            <Ionicons name="calendar-outline" size={13} color={Colors.primary} />
            <Text style={[styles.calendarBtnText, { color: Colors.primary, fontFamily: 'Inter_500Medium' }]}>Add to Calendar</Text>
          </Pressable>
        )}
      </View>
      {!isPast && (
        <Pressable onPress={onDelete} style={styles.deleteBtn}>
          <Ionicons name="close-circle-outline" size={22} color={Colors.danger} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOuter: { borderBottomWidth: 1, paddingHorizontal: 20, paddingBottom: 14 },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 28, letterSpacing: -0.3 },
  addBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
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
  sectionTitle: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  dayEmptyCard: { borderRadius: 14, borderWidth: 1, padding: 16, alignItems: 'center', gap: 10 },
  dayEmptyText: { fontSize: 14 },
  bookNowBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  bookNowText: { fontSize: 14 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyTitle: { fontSize: 18 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  apptCard: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center', gap: 12, marginBottom: 10 },
  apptDateBox: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  apptDay: { fontSize: 20, lineHeight: 22 },
  apptMonth: { fontSize: 11 },
  apptInfo: { flex: 1, gap: 3 },
  apptDoctor: { fontSize: 15 },
  apptSpec: { fontSize: 12 },
  apptMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  apptMeta: { fontSize: 12 },
  apptNotes: { fontSize: 11, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 11 },
  deleteBtn: { padding: 4 },
  calendarBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, marginTop: 6 },
  calendarBtnText: { fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc', alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, marginBottom: 16 },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  doctorPickBtn: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 52, gap: 10 },
  doctorPickContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  doctorPickName: { fontSize: 15 },
  doctorPickId: { fontSize: 11 },
  doctorPickPlaceholder: { flex: 1, fontSize: 15 },
  hintText: { fontSize: 12, marginTop: 6 },
  docAvatarSmall: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  docAvatarText: { fontSize: 16 },
  docPickItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  chipBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 13 },
  notesInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, height: 80, textAlignVertical: 'top' },
  reminderInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  reminderText: { flex: 1, fontSize: 12, lineHeight: 18 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
  saveBtn: { flex: 1.5, height: 48, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontSize: 15 },
});
