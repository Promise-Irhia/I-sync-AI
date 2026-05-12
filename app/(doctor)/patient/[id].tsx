import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme,
  Platform, Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { fetch } from 'expo/fetch';
import { useWebSocket } from '@/hooks/useWebSocket';

type Patient = { id: string; name: string; uniqueId: string; email: string; phone?: string; gender?: string; dateOfBirth?: string };
type Profile = { allergies: string[]; conditions: string[]; bloodType?: string; weight?: number; height?: number; notes?: string; emergencyContact?: any };
type VitalsRecord = { heartRate: number; systolicBP: number; diastolicBP: number; spo2: number; temperature: number; timestamp: string };
type ActivityEntry = { field: string; previousValue: string; newValue: string; doctorName: string; timestamp: string };
type Prescription = { id: string; medicationName: string; dosage: string; frequency: string; times: string[]; notes: string; prescribedAt: string };

const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times', 'As needed'];
const RX_TIMES = ['06:00', '08:00', '09:00', '12:00', '14:00', '18:00', '20:00', '22:00'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const MEAL_TIMES = ['06:00', '07:00', '07:30', '08:00', '09:00', '10:00', '12:00', '13:00', '14:00', '15:00', '18:00', '19:00', '20:00', '21:00'];
const MEAL_META: Record<string, { icon: string; color: string; label: string }> = {
  breakfast: { icon: 'sunny-outline', color: '#F59E0B', label: 'Breakfast' },
  lunch: { icon: 'partly-sunny-outline', color: '#10B981', label: 'Lunch' },
  dinner: { icon: 'moon-outline', color: '#8B5CF6', label: 'Dinner' },
  snack: { icon: 'nutrition-outline', color: '#3B82F6', label: 'Snack' },
};

export default function PatientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader } = useAuth();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vitals, setVitals] = useState<VitalsRecord[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [liveVitals, setLiveVitals] = useState<VitalsRecord | null>(null);

  const { lastMessage } = useWebSocket(patient?.uniqueId);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'VITALS_UPDATE') {
      setLiveVitals({ ...lastMessage, timestamp: new Date().toISOString() });
    } else if (lastMessage.type === 'FALL_DETECTED') {
      Alert.alert('⚠️ Fall Detected', `A fall alert was triggered for ${patient?.name ?? 'this patient'}.`);
    }
  }, [lastMessage]);

  const [showEdit, setShowEdit] = useState(false);
  const [editAllergies, setEditAllergies] = useState('');
  const [editConditions, setEditConditions] = useState('');
  const [editBloodType, setEditBloodType] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [showPrescribe, setShowPrescribe] = useState(false);
  const [rxMedName, setRxMedName] = useState('');
  const [rxDosage, setRxDosage] = useState('');
  const [rxFrequency, setRxFrequency] = useState(FREQUENCIES[0]);
  const [rxTime, setRxTime] = useState('08:00');
  const [rxNotes, setRxNotes] = useState('');
  const [isSavingRx, setIsSavingRx] = useState(false);

  const [mealPlans, setMealPlans] = useState<any[]>([]);
  const [showMealPlan, setShowMealPlan] = useState(false);
  const [mpFoodName, setMpFoodName] = useState('');
  const [mpMealType, setMpMealType] = useState<string>('breakfast');
  const [mpTime, setMpTime] = useState('08:00');
  const [mpCalories, setMpCalories] = useState('');
  const [mpNotes, setMpNotes] = useState('');
  const [isSavingMp, setIsSavingMp] = useState(false);

  const [showNutrition, setShowNutrition] = useState(false);
  const [nutCalories, setNutCalories] = useState('2000');
  const [nutProtein, setNutProtein] = useState('120');
  const [nutCarbs, setNutCarbs] = useState('250');
  const [nutFat, setNutFat] = useState('65');
  const [nutWater, setNutWater] = useState('8');
  const [nutNote, setNutNote] = useState('');
  const [isSavingNut, setIsSavingNut] = useState(false);
  const [nutSaved, setNutSaved] = useState(false);

  useEffect(() => {
    if (id) loadPatientData();
  }, [id]);

  async function loadPatientData() {
    setIsLoading(true);
    try {
      const base = getApiUrl();
      const [patRes, nutRes, mealRes] = await Promise.all([
        fetch(`${base}api/doctor/patient/${id}`, { headers: authHeader() }),
        fetch(`${base}api/doctor/patient/${id}/nutrition-goals`, { headers: authHeader() }),
        fetch(`${base}api/doctor/patient/${id}/meal-plan`, { headers: authHeader() }),
      ]);
      const data = await patRes.json();
      const nutData = await nutRes.json();
      const mealData = await mealRes.json();
      setPatient(data.patient);
      setProfile(data.profile);
      setVitals(data.vitals || []);
      setActivityLog(data.activityLog || []);
      setPrescriptions(data.prescriptions || []);
      setMealPlans(mealData.meals || []);
      if (data.profile) {
        setEditAllergies((data.profile.allergies || []).join(', '));
        setEditConditions((data.profile.conditions || []).join(', '));
        setEditBloodType(data.profile.bloodType || '');
        setEditWeight(data.profile.weight?.toString() || '');
        setEditHeight(data.profile.height?.toString() || '');
        setEditNotes(data.profile.notes || '');
      }
      if (nutData.goals) {
        const g = nutData.goals;
        setNutCalories(String(g.calories || 2000));
        setNutProtein(String(g.protein || 120));
        setNutCarbs(String(g.carbs || 250));
        setNutFat(String(g.fat || 65));
        setNutWater(String(g.water || 8));
        setNutNote(g.doctorNote || '');
      }
    } catch {
      Alert.alert('Error', 'Failed to load patient data.');
    } finally {
      setIsLoading(false);
    }
  }

  async function addMealPlanItem() {
    if (!mpFoodName.trim()) {
      Alert.alert('Missing Info', 'Please enter a food name.');
      return;
    }
    setIsSavingMp(true);
    try {
      const base = getApiUrl();
      const res = await fetch(`${base}api/doctor/patient/${id}/meal-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          mealType: mpMealType,
          foodName: mpFoodName.trim(),
          scheduledTime: mpTime,
          calories: Number(mpCalories) || 0,
          notes: mpNotes.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMealPlans(prev => [...prev, data.meal].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)));
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setMpFoodName(''); setMpMealType('breakfast'); setMpTime('08:00'); setMpCalories(''); setMpNotes('');
        setShowMealPlan(false);
      } else {
        Alert.alert('Error', 'Failed to add meal.');
      }
    } catch {
      Alert.alert('Error', 'Network error.');
    }
    setIsSavingMp(false);
  }

  async function deleteMealPlanItem(mealId: string, foodName: string) {
    Alert.alert('Remove Meal', `Remove "${foodName}" from the meal plan?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            const base = getApiUrl();
            await fetch(`${base}api/doctor/patient/${id}/meal-plan/${mealId}`, {
              method: 'DELETE',
              headers: authHeader(),
            });
            setMealPlans(prev => prev.filter(m => m.id !== mealId));
          } catch {}
        },
      },
    ]);
  }

  async function saveNutritionGoals() {
    setIsSavingNut(true);
    try {
      const base = getApiUrl();
      await fetch(`${base}api/doctor/patient/${id}/nutrition-goals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          calories: Number(nutCalories) || 2000,
          protein: Number(nutProtein) || 120,
          carbs: Number(nutCarbs) || 250,
          fat: Number(nutFat) || 65,
          water: Number(nutWater) || 8,
          doctorNote: nutNote.trim(),
        }),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNutSaved(true);
      setTimeout(() => { setNutSaved(false); setShowNutrition(false); }, 1200);
    } catch {
      Alert.alert('Error', 'Failed to save nutrition goals.');
    } finally {
      setIsSavingNut(false);
    }
  }

  async function saveProfile() {
    if (!id) return;
    setIsSaving(true);
    try {
      const base = getApiUrl();
      const updates = {
        allergies: editAllergies.split(',').map(s => s.trim()).filter(Boolean),
        conditions: editConditions.split(',').map(s => s.trim()).filter(Boolean),
        bloodType: editBloodType.trim() || undefined,
        weight: editWeight ? parseFloat(editWeight) : undefined,
        height: editHeight ? parseFloat(editHeight) : undefined,
        notes: editNotes.trim() || undefined,
      };
      const res = await fetch(`${base}api/doctor/patient/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        await loadPatientData();
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowEdit(false);
    } catch {
      Alert.alert('Error', 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  }

  async function prescribeMedication() {
    if (!rxMedName.trim() || !rxDosage.trim()) {
      Alert.alert('Missing Info', 'Please enter medication name and dosage.');
      return;
    }
    setIsSavingRx(true);
    try {
      const base = getApiUrl();
      const res = await fetch(`${base}api/doctor/patient/${id}/prescriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          medicationName: rxMedName.trim(),
          dosage: rxDosage.trim(),
          frequency: rxFrequency,
          times: [rxTime],
          notes: rxNotes.trim(),
        }),
      });
      if (res.ok) {
        await loadPatientData();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRxMedName(''); setRxDosage(''); setRxFrequency(FREQUENCIES[0]); setRxTime('08:00'); setRxNotes('');
        setShowPrescribe(false);
      } else {
        Alert.alert('Error', 'Failed to prescribe medication.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    }
    setIsSavingRx(false);
  }

  async function deletePrescription(rxId: string) {
    const base = getApiUrl();
    await fetch(`${base}api/doctor/patient/${id}/prescriptions/${rxId}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    await loadPatientData();
  }

  const latestVitals = vitals.length > 0 ? vitals[vitals.length - 1] : null;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!patient) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: C.bg }]}>
        <Text style={{ color: C.textSub }}>Patient not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.headerOuter, { paddingTop: topPad + 8, borderBottomColor: C.divider }]}>
      <View style={[styles.headerInner, webC]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Patient Record</Text>
        <View style={styles.headerBtns}>
          <Pressable onPress={() => setShowNutrition(true)} style={[styles.editBtn, { backgroundColor: '#10B98120' }]}>
            <Ionicons name="nutrition-outline" size={18} color="#10B981" />
          </Pressable>
          <Pressable onPress={() => setShowPrescribe(true)} style={[styles.editBtn, { backgroundColor: Colors.purple + '20' }]}>
            <Ionicons name="medical-outline" size={18} color={Colors.purple} />
          </Pressable>
          <Pressable onPress={() => setShowEdit(true)} style={[styles.editBtn, { backgroundColor: Colors.primary + '20' }]}>
            <Ionicons name="create-outline" size={18} color={Colors.primary} />
          </Pressable>
        </View>
      </View>
      </View>

      <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: 100 }, WEB && { alignItems: 'center' }]} showsVerticalScrollIndicator={false}>
      <View style={webC}>
        <View style={[styles.patientCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={[styles.patientAvatar, { backgroundColor: Colors.primary + '20' }]}>
            <Text style={[styles.avatarText, { color: Colors.primary, fontFamily: 'Inter_700Bold' }]}>
              {patient.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.patientInfo}>
            <Text style={[styles.patientName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>{patient.name}</Text>
            <View style={[styles.idBadge, { backgroundColor: Colors.primary + '20' }]}>
              <Text style={[styles.idText, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{patient.uniqueId}</Text>
            </View>
          </View>
          <View style={styles.patientMeta}>
            {patient.gender && <MetaChip label={patient.gender} C={C} />}
            {patient.dateOfBirth && <MetaChip label={patient.dateOfBirth} C={C} />}
            {patient.phone && <MetaChip label={patient.phone} C={C} />}
          </View>
        </View>

        {liveVitals && (
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Live Vitals</Text>
              <View style={{ backgroundColor: '#10B981', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'Inter_600SemiBold' }}>LIVE</Text>
              </View>
            </View>
            <Text style={[styles.sectionSub, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              Streaming from patient device
            </Text>
            <View style={styles.vitalsGrid}>
              <VitalBox label="Heart Rate" value={`${liveVitals.heartRate}`} unit="BPM" color={Colors.danger} icon="heart" />
              <VitalBox label="Blood Pressure" value={`${liveVitals.systolicBP}/${liveVitals.diastolicBP}`} unit="mmHg" color={Colors.warning} icon="speedometer" />
              <VitalBox label="SpO2" value={`${liveVitals.spo2}`} unit="%" color={Colors.primary} icon="water" />
              <VitalBox label="Temperature" value={`${Number(liveVitals.temperature).toFixed(1)}`} unit="°C" color={Colors.secondary} icon="thermometer" />
            </View>
          </View>
        )}

        {latestVitals && (
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Latest Vitals</Text>
            <Text style={[styles.sectionSub, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              {new Date(latestVitals.timestamp).toLocaleString()}
            </Text>
            <View style={styles.vitalsGrid}>
              <VitalBox label="Heart Rate" value={`${Math.round(latestVitals.heartRate)}`} unit="BPM" color={Colors.danger} icon="heart" />
              <VitalBox label="Blood Pressure" value={`${Math.round(latestVitals.systolicBP)}/${Math.round(latestVitals.diastolicBP)}`} unit="mmHg" color={Colors.warning} icon="speedometer" />
              <VitalBox label="SpO2" value={`${Math.round(latestVitals.spo2)}`} unit="%" color={Colors.primary} icon="water" />
              <VitalBox label="Temperature" value={`${latestVitals.temperature.toFixed(1)}`} unit="°C" color={Colors.secondary} icon="thermometer" />
            </View>
          </View>
        )}

        {vitals.length > 1 && (
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Heart Rate History</Text>
            <MiniTrendChart data={vitals} color={Colors.danger} />
          </View>
        )}

        <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Medical Profile</Text>
            <Pressable onPress={() => setShowEdit(true)}>
              <Ionicons name="pencil-outline" size={16} color={Colors.primary} />
            </Pressable>
          </View>
          {profile?.bloodType && <ProfileRow label="Blood Type" value={profile.bloodType} C={C} />}
          {profile?.weight && <ProfileRow label="Weight" value={`${profile.weight} kg`} C={C} />}
          {profile?.height && <ProfileRow label="Height" value={`${profile.height} cm`} C={C} />}
          {profile?.allergies && profile.allergies.length > 0 && (
            <View style={styles.profileTagRow}>
              <Text style={[styles.profileTagLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>Allergies</Text>
              <View style={styles.tagWrap}>
                {profile.allergies.map((a, i) => (
                  <View key={i} style={[styles.tag, { backgroundColor: Colors.danger + '18' }]}>
                    <Text style={[styles.tagText, { color: Colors.danger, fontFamily: 'Inter_500Medium' }]}>{a}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {profile?.conditions && profile.conditions.length > 0 && (
            <View style={styles.profileTagRow}>
              <Text style={[styles.profileTagLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>Conditions</Text>
              <View style={styles.tagWrap}>
                {profile.conditions.map((c, i) => (
                  <View key={i} style={[styles.tag, { backgroundColor: Colors.warning + '18' }]}>
                    <Text style={[styles.tagText, { color: Colors.warning, fontFamily: 'Inter_500Medium' }]}>{c}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {profile?.notes && <ProfileRow label="Notes" value={profile.notes} C={C} />}
          {(!profile?.bloodType && !profile?.weight && (!profile?.allergies?.length) && (!profile?.conditions?.length)) && (
            <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              No medical profile data. Tap edit to add information.
            </Text>
          )}
        </View>

        {/* Prescriptions section */}
        <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="medical" size={16} color={Colors.purple} />
              <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Prescriptions</Text>
            </View>
            <Pressable onPress={() => setShowPrescribe(true)} style={[styles.prescribeBtn, { backgroundColor: Colors.purple + '18', borderColor: Colors.purple + '30' }]}>
              <Ionicons name="add" size={14} color={Colors.purple} />
              <Text style={[styles.prescribeBtnText, { color: Colors.purple, fontFamily: 'Inter_600SemiBold' }]}>Prescribe</Text>
            </Pressable>
          </View>
          {prescriptions.length === 0 ? (
            <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>No prescriptions yet. Tap Prescribe to add one.</Text>
          ) : (
            prescriptions.map(rx => (
              <View key={rx.id} style={[styles.rxCard, { backgroundColor: Colors.purple + '0D', borderColor: Colors.purple + '30' }]}>
                <View style={styles.rxHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rxName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{rx.medicationName}</Text>
                    <Text style={[styles.rxDosage, { color: Colors.purple, fontFamily: 'Inter_500Medium' }]}>{rx.dosage} · {rx.frequency}</Text>
                  </View>
                  <Pressable onPress={() => Alert.alert('Remove', `Remove prescription for ${rx.medicationName}?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => deletePrescription(rx.id) },
                  ])}>
                    <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                  </Pressable>
                </View>
                <View style={styles.rxTimes}>
                  {rx.times.map((t, i) => (
                    <View key={i} style={[styles.timeChip, { backgroundColor: Colors.purple + '18' }]}>
                      <Ionicons name="alarm-outline" size={11} color={Colors.purple} />
                      <Text style={[styles.timeChipText, { color: Colors.purple, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
                    </View>
                  ))}
                </View>
                {rx.notes ? <Text style={[styles.rxNotes, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{rx.notes}</Text> : null}
                <Text style={[styles.rxDate, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                  Prescribed {new Date(rx.prescribedAt).toLocaleDateString()}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Nutrition Goals section */}
        <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="nutrition" size={16} color="#10B981" />
              <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Nutrition Goals</Text>
            </View>
            <Pressable onPress={() => setShowNutrition(true)} style={[styles.prescribeBtn, { backgroundColor: '#10B98118', borderColor: '#10B98130' }]}>
              <Ionicons name="create-outline" size={14} color="#10B981" />
              <Text style={[styles.prescribeBtnText, { color: '#10B981', fontFamily: 'Inter_600SemiBold' }]}>Edit</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {[
              { label: 'Calories', value: nutCalories, unit: 'kcal', color: Colors.primary },
              { label: 'Protein', value: nutProtein, unit: 'g', color: '#10B981' },
              { label: 'Carbs', value: nutCarbs, unit: 'g', color: '#F59E0B' },
              { label: 'Fat', value: nutFat, unit: 'g', color: '#8B5CF6' },
              { label: 'Water', value: nutWater, unit: 'glasses', color: Colors.primary },
            ].map(item => (
              <View key={item.label} style={[styles.nutChip, { backgroundColor: item.color + '12', borderColor: item.color + '30' }]}>
                <Text style={[{ color: item.color, fontFamily: 'Inter_700Bold', fontSize: 15 }]}>{item.value}</Text>
                <Text style={[{ color: item.color, fontFamily: 'Inter_400Regular', fontSize: 10, opacity: 0.8 }]}>{item.unit}</Text>
                <Text style={[{ color: C.textMuted, fontFamily: 'Inter_500Medium', fontSize: 10 }]}>{item.label}</Text>
              </View>
            ))}
          </View>
          {nutNote ? (
            <View style={[styles.nutNoteRow, { backgroundColor: '#10B98110', borderColor: '#10B98130' }]}>
              <Ionicons name="chatbox-outline" size={14} color="#10B981" />
              <Text style={[{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 12, flex: 1, lineHeight: 17 }]}>{nutNote}</Text>
            </View>
          ) : null}
        </View>

        {/* Meal Plan section */}
        <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="restaurant" size={16} color="#F59E0B" />
              <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Meal Plan</Text>
            </View>
            <Pressable onPress={() => setShowMealPlan(true)} style={[styles.prescribeBtn, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B30' }]}>
              <Ionicons name="add" size={14} color="#F59E0B" />
              <Text style={[styles.prescribeBtnText, { color: '#F59E0B', fontFamily: 'Inter_600SemiBold' }]}>Add Meal</Text>
            </Pressable>
          </View>
          {mealPlans.length === 0 ? (
            <Text style={[styles.emptyText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>No meals added yet. Tap Add Meal to create a meal plan for this patient.</Text>
          ) : (
            mealPlans.map(meal => {
              const meta = MEAL_META[meal.mealType] || MEAL_META.snack;
              return (
                <View key={meal.id} style={[styles.rxCard, { backgroundColor: meta.color + '0D', borderColor: meta.color + '30' }]}>
                  <View style={styles.rxHeader}>
                    <View style={[{ width: 32, height: 32, borderRadius: 10, backgroundColor: meta.color + '20', alignItems: 'center', justifyContent: 'center', marginRight: 10 }]}>
                      <Ionicons name={meta.icon as any} size={16} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rxName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>{meal.foodName}</Text>
                      <Text style={[styles.rxDosage, { color: meta.color, fontFamily: 'Inter_500Medium' }]}>{meta.label}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={[styles.timeChip, { backgroundColor: meta.color + '18' }]}>
                        <Ionicons name="alarm-outline" size={11} color={meta.color} />
                        <Text style={[styles.timeChipText, { color: meta.color, fontFamily: 'Inter_500Medium' }]}>{meal.scheduledTime}</Text>
                      </View>
                      {meal.calories > 0 && (
                        <Text style={[{ fontSize: 11, color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{meal.calories} kcal</Text>
                      )}
                    </View>
                    <Pressable onPress={() => deleteMealPlanItem(meal.id, meal.foodName)} style={{ padding: 4, marginLeft: 8 }}>
                      <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                    </Pressable>
                  </View>
                  {meal.notes ? <Text style={[styles.rxNotes, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{meal.notes}</Text> : null}
                </View>
              );
            })
          )}
        </View>

        {activityLog.length > 0 && (
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Activity Log</Text>
            {activityLog.slice(0, 8).map((entry, i) => (
              <View key={i} style={[styles.logEntry, { borderBottomColor: C.divider }]}>
                <View style={styles.logHeader}>
                  <Text style={[styles.logDoctor, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>Dr. {entry.doctorName}</Text>
                  <Text style={[styles.logTime, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{new Date(entry.timestamp).toLocaleDateString()}</Text>
                </View>
                <Text style={[styles.logDetail, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                  Changed <Text style={{ fontFamily: 'Inter_600SemiBold', color: C.text }}>{entry.field}</Text>
                </Text>
                <Text style={[styles.logChange, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                  {entry.previousValue} → {entry.newValue}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      </ScrollView>

      {/* Meal Plan Modal */}
      <Modal visible={showMealPlan} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Add Meal to Plan</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
              <FormField label="Food Name *" value={mpFoodName} onChange={setMpFoodName} placeholder="e.g., Grilled Chicken with Rice" C={C} />

              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Meal Type</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {MEAL_TYPES.map(type => {
                    const meta = MEAL_META[type];
                    const isSelected = mpMealType === type;
                    return (
                      <Pressable key={type}
                        style={[styles.chipBtn, { backgroundColor: isSelected ? meta.color + '25' : C.input, borderColor: isSelected ? meta.color : C.inputBorder }]}
                        onPress={() => setMpMealType(type)}
                      >
                        <Text style={[styles.chipText, { color: isSelected ? meta.color : C.textSub, fontFamily: 'Inter_500Medium' }]}>{meta.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Scheduled Time</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {MEAL_TIMES.map(t => (
                    <Pressable key={t}
                      style={[styles.chipBtn, { backgroundColor: mpTime === t ? '#F59E0B25' : C.input, borderColor: mpTime === t ? '#F59E0B' : C.inputBorder }]}
                      onPress={() => setMpTime(t)}
                    >
                      <Text style={[styles.chipText, { color: mpTime === t ? '#F59E0B' : C.textSub, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <FormField label="Calories (optional)" value={mpCalories} onChange={setMpCalories} placeholder="e.g., 450" C={C} keyboardType="numeric" />
              <FormField label="Notes (optional)" value={mpNotes} onChange={setMpNotes} placeholder="e.g., Low sodium, steamed vegetables..." C={C} multiline />

              <View style={styles.modalBtns}>
                <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowMealPlan(false)}>
                  <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.saveBtn, { backgroundColor: '#F59E0B', opacity: isSavingMp ? 0.7 : 1 }]} onPress={addMealPlanItem} disabled={isSavingMp}>
                  {isSavingMp ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Add Meal</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Prescribe Modal */}
      <Modal visible={showPrescribe} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Prescribe Medication</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
              <FormField label="Medication Name *" value={rxMedName} onChange={setRxMedName} placeholder="e.g., Amoxicillin" C={C} />
              <FormField label="Dosage *" value={rxDosage} onChange={setRxDosage} placeholder="e.g., 500mg" C={C} />

              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Frequency</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {FREQUENCIES.map(f => (
                    <Pressable key={f}
                      style={[styles.chipBtn, { backgroundColor: rxFrequency === f ? Colors.purple + '20' : C.input, borderColor: rxFrequency === f ? Colors.purple : C.inputBorder }]}
                      onPress={() => setRxFrequency(f)}
                    >
                      <Text style={[styles.chipText, { color: rxFrequency === f ? Colors.purple : C.textSub, fontFamily: 'Inter_500Medium' }]}>{f}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View>
                <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>Reminder Time</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {RX_TIMES.map(t => (
                    <Pressable key={t}
                      style={[styles.chipBtn, { backgroundColor: rxTime === t ? Colors.purple + '20' : C.input, borderColor: rxTime === t ? Colors.purple : C.inputBorder }]}
                      onPress={() => setRxTime(t)}
                    >
                      <Text style={[styles.chipText, { color: rxTime === t ? Colors.purple : C.textSub, fontFamily: 'Inter_500Medium' }]}>{t}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <FormField label="Instructions / Notes" value={rxNotes} onChange={setRxNotes} placeholder="Take with food, avoid alcohol..." C={C} multiline />

              <View style={styles.modalBtns}>
                <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowPrescribe(false)}>
                  <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.saveBtn, { backgroundColor: Colors.purple, opacity: isSavingRx ? 0.7 : 1 }]} onPress={prescribeMedication} disabled={isSavingRx}>
                  {isSavingRx ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Prescribe</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Nutrition Goals Modal */}
      <Modal visible={showNutrition} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Set Nutrition Goals</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <FormField label="Calories (kcal)" value={nutCalories} onChange={setNutCalories} placeholder="2000" C={C} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="Water (glasses)" value={nutWater} onChange={setNutWater} placeholder="8" C={C} keyboardType="numeric" />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <FormField label="Protein (g)" value={nutProtein} onChange={setNutProtein} placeholder="120" C={C} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="Carbs (g)" value={nutCarbs} onChange={setNutCarbs} placeholder="250" C={C} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="Fat (g)" value={nutFat} onChange={setNutFat} placeholder="65" C={C} keyboardType="numeric" />
                </View>
              </View>
              <FormField label="Doctor's Note (shown to patient)" value={nutNote} onChange={setNutNote} placeholder="e.g. Reduce carbs due to pre-diabetes..." C={C} multiline />
              <View style={styles.modalBtns}>
                <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowNutrition(false)}>
                  <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.saveBtn, { backgroundColor: '#10B981', opacity: isSavingNut ? 0.7 : 1 }]} onPress={saveNutritionGoals} disabled={isSavingNut}>
                  {isSavingNut ? <ActivityIndicator color="#fff" size="small" /> :
                    nutSaved ? <Ionicons name="checkmark" size={20} color="#fff" /> :
                    <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Save Goals</Text>
                  }
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showEdit} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Edit Medical Profile</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
              <FormField label="Blood Type" value={editBloodType} onChange={setEditBloodType} placeholder="A+, B-, O+, AB+" C={C} />
              <FormField label="Weight (kg)" value={editWeight} onChange={setEditWeight} placeholder="70" C={C} keyboardType="numeric" />
              <FormField label="Height (cm)" value={editHeight} onChange={setEditHeight} placeholder="175" C={C} keyboardType="numeric" />
              <FormField label="Allergies (comma-separated)" value={editAllergies} onChange={setEditAllergies} placeholder="Penicillin, Aspirin" C={C} />
              <FormField label="Medical Conditions (comma-separated)" value={editConditions} onChange={setEditConditions} placeholder="Hypertension, Diabetes" C={C} />
              <FormField label="Clinical Notes" value={editNotes} onChange={setEditNotes} placeholder="Additional clinical notes..." C={C} multiline />
              <View style={styles.modalBtns}>
                <Pressable style={[styles.cancelBtn, { borderColor: C.cardBorder }]} onPress={() => setShowEdit(false)}>
                  <Text style={[styles.cancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.saveBtn} onPress={saveProfile} disabled={isSaving}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : (
                    <Text style={[styles.saveText, { fontFamily: 'Inter_600SemiBold' }]}>Save Changes</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function VitalBox({ label, value, unit, color, icon }: any) {
  return (
    <View style={[styles.vitalBox, { backgroundColor: color + '10', borderColor: color + '30' }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.vitalValue, { color, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
      <Text style={[styles.vitalUnit, { color, fontFamily: 'Inter_400Regular', opacity: 0.7 }]}>{unit}</Text>
      <Text style={[styles.vitalLabel, { color, fontFamily: 'Inter_400Regular', opacity: 0.7 }]}>{label}</Text>
    </View>
  );
}

function MetaChip({ label, C }: { label: string; C: any }) {
  return (
    <View style={[styles.metaChip, { backgroundColor: C.input }]}>
      <Text style={[styles.metaText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
    </View>
  );
}

function ProfileRow({ label, value, C }: any) {
  return (
    <View style={[styles.profileRow, { borderBottomColor: C.divider }]}>
      <Text style={[styles.profileRowLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <Text style={[styles.profileRowValue, { color: C.text, fontFamily: 'Inter_400Regular' }]}>{value}</Text>
    </View>
  );
}

function MiniTrendChart({ data, color }: { data: VitalsRecord[]; color: string }) {
  const recent = data.slice(-12);
  const max = Math.max(...recent.map(d => d.heartRate));
  const min = Math.min(...recent.map(d => d.heartRate));
  const range = max - min || 1;
  return (
    <View style={styles.trendChart}>
      {recent.map((d, i) => {
        const h = Math.max(6, ((d.heartRate - min) / range) * 60);
        return <View key={i} style={[styles.trendBar, { height: h, backgroundColor: color, opacity: 0.25 + (i / recent.length) * 0.75 }]} />;
      })}
    </View>
  );
}

function FormField({ label, value, onChange, placeholder, C, keyboardType, multiline }: any) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text, fontFamily: 'Inter_400Regular', height: multiline ? 80 : 48, textAlignVertical: multiline ? 'top' : 'center' }]}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.textMuted}
        keyboardType={keyboardType || 'default'} multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerOuter: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, flex: 1, textAlign: 'center' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  editBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  prescribeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  nutChip: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, minWidth: 64 },
  nutNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 10 },
  prescribeBtnText: { fontSize: 12 },
  rxCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  rxHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  rxName: { fontSize: 15 },
  rxDosage: { fontSize: 13, marginTop: 2 },
  rxTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  timeChipText: { fontSize: 12 },
  rxNotes: { fontSize: 12, fontStyle: 'italic' },
  rxDate: { fontSize: 11, marginTop: 2 },
  chipBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 13 },
  patientCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, alignItems: 'center', gap: 8 },
  patientAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24 },
  patientInfo: { alignItems: 'center', gap: 6 },
  patientName: { fontSize: 20, letterSpacing: -0.3 },
  idBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  idText: { fontSize: 12 },
  patientMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  metaChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  metaText: { fontSize: 12 },
  section: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, gap: 8 },
  sectionTitle: { fontSize: 15 },
  sectionSub: { fontSize: 11, marginTop: -4 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  vitalBox: { width: '47%', borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  vitalValue: { fontSize: 22, letterSpacing: -0.5 },
  vitalUnit: { fontSize: 12 },
  vitalLabel: { fontSize: 11 },
  trendChart: { flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 3, marginTop: 8 },
  trendBar: { flex: 1, borderRadius: 3 },
  profileRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  profileRowLabel: { fontSize: 13, width: 100 },
  profileRowValue: { flex: 1, fontSize: 14 },
  profileTagRow: { gap: 6, paddingVertical: 6 },
  profileTagLabel: { fontSize: 12 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 12 },
  emptyText: { fontSize: 13, paddingVertical: 8 },
  logEntry: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  logDoctor: { fontSize: 13 },
  logTime: { fontSize: 12 },
  logDetail: { fontSize: 13 },
  logChange: { fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc', alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, marginBottom: 4 },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  fieldInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
  saveBtn: { flex: 1.5, height: 48, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontSize: 15 },
});
