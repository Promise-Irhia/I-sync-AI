import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  useColorScheme,
  Platform,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { fetch } from 'expo/fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBLE } from '@/context/BLEContext';
import FallDetectionCard from '@/components/FallDetectionCard';
import { useWebSocket } from '@/hooks/useWebSocket';

type VitalHistory = { value: number; time: string }[];

function getStatus(vital: string, value: number): 'normal' | 'warning' | 'danger' {
  switch (vital) {
    case 'heartRate':
      if (value < 60 || value > 100) return value < 50 || value > 110 ? 'danger' : 'warning';
      return 'normal';
    case 'systolicBP':
      if (value > 140 || value < 90) return value > 160 || value < 80 ? 'danger' : 'warning';
      return 'normal';
    case 'spo2':
      if (value < 95) return value < 92 ? 'danger' : 'warning';
      return 'normal';
    case 'temperature':
      if (value > 37.5 || value < 36.1) return value > 38.5 || value < 35.5 ? 'danger' : 'warning';
      return 'normal';
    default:
      return 'normal';
  }
}

function statusColor(status: string) {
  if (status === 'danger') return Colors.danger;
  if (status === 'warning') return Colors.warning;
  return Colors.secondary;
}

export default function PatientDashboard() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { user, token, authHeader, handleUnauthorized } = useAuth();

  const [hrHistory, setHrHistory] = useState<VitalHistory>([]);
  const [timeOfDay, setTimeOfDay] = useState(getTimeOfDay());
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState('');
  const [emergencyLocation, setEmergencyLocation] = useState('');
  const [emergencyMapsLink, setEmergencyMapsLink] = useState('');
  const [emergencyContacts, setEmergencyContacts] = useState<any[]>([]);
  const [sentContacts, setSentContacts] = useState<Set<string>>(new Set());
  const [showBluetooth, setShowBluetooth] = useState(false);

  const bt = useBLE();
  const { send: wsSend } = useWebSocket(user?.uniqueId);

  const pulseScale = useSharedValue(1);
  const emergencyPulse = useSharedValue(1);
  const hrAlertCooldownRef = useRef<number>(0);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
    emergencyPulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 800 }),
        withTiming(1, { duration: 800 })
      ),
      -1,
      false
    );

    const greetingTimer = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
    }, 60_000);

    return () => { clearInterval(greetingTimer); };
  }, []);

  // Track real BLE heart rate history for the trend chart
  useEffect(() => {
    if (bt.status !== 'connected' || !bt.vitals.heartRate) return;
    const entry = {
      value: bt.vitals.heartRate,
      time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
    };
    setHrHistory(h => [...h, entry].slice(-12));
  }, [bt.vitals.heartRate]);

  const syncToServer = useCallback(async () => {
    if (!token || bt.status !== 'connected' || !bt.vitals.heartRate) return;
    try {
      const base = getApiUrl();
      const res = await fetch(`${base}api/patient/vitals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          heartRate: Math.round(bt.vitals.heartRate),
          systolicBP: bt.vitals.systolicBP ? Math.round(bt.vitals.systolicBP) : null,
          diastolicBP: bt.vitals.diastolicBP ? Math.round(bt.vitals.diastolicBP) : null,
          spo2: bt.vitals.spo2 ? Math.round(bt.vitals.spo2 * 10) / 10 : null,
          temperature: bt.vitals.temperature ? Math.round(bt.vitals.temperature * 10) / 10 : null,
        }),
      });
      if (res.status === 401) { await handleUnauthorized(); }
    } catch {}
  }, [bt.vitals, bt.status, token]);

  useEffect(() => { syncToServer(); }, [bt.vitals]);

  // Only broadcast real BLE vitals over WebSocket
  useEffect(() => {
    if (bt.status !== 'connected' || !bt.vitals.heartRate) return;
    wsSend({
      type: 'VITALS_UPDATE',
      heartRate: Math.round(bt.vitals.heartRate),
      systolicBP: bt.vitals.systolicBP ? Math.round(bt.vitals.systolicBP) : null,
      diastolicBP: bt.vitals.diastolicBP ? Math.round(bt.vitals.diastolicBP) : null,
      spo2: bt.vitals.spo2 ? Math.round(bt.vitals.spo2 * 10) / 10 : null,
      temperature: bt.vitals.temperature ? Math.round(bt.vitals.temperature * 10) / 10 : null,
      timestamp: new Date().toISOString(),
    });
  }, [bt.vitals, bt.status]);

  // ── Auto HR spike alert (only on real BLE data) ─────────────────────────────
  useEffect(() => {
    if (bt.status !== 'connected' || !bt.vitals.heartRate) return;
    const hr = bt.vitals.heartRate;
    if (getStatus('heartRate', hr) !== 'danger') return;

    const now = Date.now();
    const TEN_MIN = 10 * 60 * 1000;
    if (now - hrAlertCooldownRef.current < TEN_MIN) return;
    hrAlertCooldownRef.current = now;

    (async () => {
      try {
        let contacts: any[] = [];
        try {
          const stored = await AsyncStorage.getItem('isync_emergency_contacts');
          if (stored) contacts = JSON.parse(stored);
        } catch {}
        if (contacts.length === 0) return;

        let locationLat: number | undefined, locationLng: number | undefined;
        try {
          if (Platform.OS !== 'web') {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
              locationLat = loc.coords.latitude;
              locationLng = loc.coords.longitude;
            }
          }
        } catch {}

        const base = getApiUrl();
        await fetch(`${base}api/patient/hr-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({
            heartRate: Math.round(hr),
            systolicBP: bt.vitals.systolicBP ? Math.round(bt.vitals.systolicBP) : null,
            diastolicBP: bt.vitals.diastolicBP ? Math.round(bt.vitals.diastolicBP) : null,
            spo2: bt.vitals.spo2 ? Math.round(bt.vitals.spo2) : null,
            temperature: bt.vitals.temperature ?? null,
            emergencyContacts: contacts,
            locationLat,
            locationLng,
          }),
        });
      } catch {}
    })();
  }, [bt.vitals.heartRate, bt.status]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulseScale.value }] }));
  const emergencyStyle = useAnimatedStyle(() => ({ transform: [{ scale: emergencyPulse.value }] }));

  async function handleEmergency() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setShowEmergency(true);
  }

  async function confirmEmergency() {
    setEmergencyLoading(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    let locationStr = 'Location unavailable';
    let mapsLink = '';

    try {
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const lat = loc.coords.latitude.toFixed(5);
          const lng = loc.coords.longitude.toFixed(5);
          locationStr = `${lat}, ${lng}`;
          mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
        }
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude.toFixed(5);
              const lng = pos.coords.longitude.toFixed(5);
              locationStr = `${lat}, ${lng}`;
              mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
              resolve();
            },
            () => resolve(),
            { timeout: 5000 }
          );
        });
      }
    } catch {}

    const patientName = user?.name ?? 'Unknown patient';
    const patientId = user?.uniqueId ?? '';
    const vStr = [
      bt.vitals.heartRate     !== undefined ? `HR:${Math.round(bt.vitals.heartRate)}bpm` : null,
      bt.vitals.systolicBP    !== undefined && bt.vitals.diastolicBP !== undefined ? `BP:${Math.round(bt.vitals.systolicBP)}/${Math.round(bt.vitals.diastolicBP)}mmHg` : null,
      bt.vitals.spo2          !== undefined ? `SpO2:${Math.round(bt.vitals.spo2)}%` : null,
      bt.vitals.temperature   !== undefined ? `Temp:${bt.vitals.temperature.toFixed(1)}°C` : null,
    ].filter(Boolean).join(' ') || 'Vitals unavailable';
    const smsBody = `🚨 EMERGENCY ALERT\nPatient: ${patientName} (${patientId}) needs immediate help.\nVitals: ${vStr}\nLocation: ${locationStr}${mapsLink ? `\nMap: ${mapsLink}` : ''}\nPlease respond immediately.`;

    let contacts: any[] = [];
    try {
      const stored = await AsyncStorage.getItem('isync_emergency_contacts');
      if (stored) contacts = JSON.parse(stored);
    } catch {}

    setEmergencyLoading(false);
    setShowEmergency(false);
    setEmergencyMessage(smsBody);
    setEmergencyLocation(locationStr);
    setEmergencyMapsLink(mapsLink);
    setEmergencyContacts(contacts);
    setSentContacts(new Set());
    setShowEmergencyPanel(true);

    // Auto-open SMS for ALL contacts in sequence (300ms gap)
    if (contacts.length > 0) {
      contacts.forEach((contact: any, idx: number) => {
        const phone = contact.phone?.replace(/[^+\d]/g, '') ?? '';
        if (!phone) return;
        setTimeout(() => {
          const smsUrl = Platform.OS === 'ios'
            ? `sms:${phone}&body=${encodeURIComponent(smsBody)}`
            : `sms:${phone}?body=${encodeURIComponent(smsBody)}`;
          Linking.openURL(smsUrl);
          setSentContacts(prev => new Set([...prev, phone]));
        }, idx * 1500);
      });
    }
  }

  function smsContact(contact: any) {
    const phone = contact.phone?.replace(/[^+\d]/g, '') ?? '';
    if (!phone) return;
    const smsUrl = Platform.OS === 'ios'
      ? `sms:${phone}&body=${encodeURIComponent(emergencyMessage)}`
      : `sms:${phone}?body=${encodeURIComponent(emergencyMessage)}`;
    Linking.openURL(smsUrl);
    setSentContacts(prev => new Set([...prev, phone]));
  }

  function callContact(contact: any) {
    const phone = contact.phone?.replace(/[^+\d]/g, '') ?? '';
    if (phone) Linking.openURL(`tel:${phone}`);
  }

  const WEB = Platform.OS === 'web';
  const topPad = WEB ? 67 : insets.top;
  const isDeviceConnected = bt.status === 'connected';
  const isLive = isDeviceConnected && bt.vitals.heartRate !== undefined;
  const hrStatus  = bt.vitals.heartRate  !== undefined ? getStatus('heartRate',  bt.vitals.heartRate)  : 'normal';
  const bpStatus  = bt.vitals.systolicBP !== undefined ? getStatus('systolicBP', bt.vitals.systolicBP) : 'normal';
  const spo2Status = bt.vitals.spo2      !== undefined ? getStatus('spo2',       bt.vitals.spo2)       : 'normal';
  const tempStatus = bt.vitals.temperature !== undefined ? getStatus('temperature', bt.vitals.temperature) : 'normal';

  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' as const } : {};

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          { paddingTop: topPad + 8, paddingBottom: 100, paddingHorizontal: 20 },
          WEB && { alignItems: 'center' },
        ]}
      >
      <View style={webC}>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.greeting, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              Good {timeOfDay}
            </Text>
            <Text style={[styles.userName, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
              {user?.name?.split(' ')[0] ?? 'Patient'}
            </Text>
          </View>
          <View style={[styles.idBadge, { backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '40' }]}>
            <Text style={[styles.idText, { color: Colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
              {user?.uniqueId}
            </Text>
          </View>
        </View>

        {/* Connectivity row */}
        <Pressable
          style={[styles.syncRow, { backgroundColor: C.card, borderColor: isLive ? '#22c55e50' : isDeviceConnected ? Colors.primary + '50' : C.cardBorder }]}
          onPress={() => setShowBluetooth(true)}
        >
          <View style={[styles.syncDot, { backgroundColor: isLive ? '#22c55e' : isDeviceConnected ? Colors.primary : Colors.warning }]} />
          <Text style={[styles.syncText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
            {isLive
              ? `Live · ${bt.deviceName}`
              : isDeviceConnected
                ? `Connected: ${bt.deviceName} · waiting for data…`
                : bt.status === 'connecting' || bt.status === 'scanning'
                  ? 'Connecting…'
                  : 'No device · Tap to connect ESP32'}
          </Text>
          <Ionicons
            name={isDeviceConnected ? 'bluetooth' : 'bluetooth-outline'}
            size={16}
            color={isLive ? '#22c55e' : isDeviceConnected ? Colors.primary : C.textMuted}
          />
        </Pressable>

        <View style={styles.heartSection}>
          <Animated.View style={pulseStyle}>
            <View style={[styles.heartCircle, { backgroundColor: Colors.danger + '18', borderColor: Colors.danger + '30' }]}>
              <Ionicons name="heart" size={40} color={Colors.danger} />
            </View>
          </Animated.View>
          <View style={styles.heartInfo}>
            <View style={styles.bpmRow}>
              <Text style={[styles.bpmValue, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                {bt.vitals.heartRate !== undefined ? Math.round(bt.vitals.heartRate) : '--'}
              </Text>
              {isLive && (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={[styles.liveText, { fontFamily: 'Inter_600SemiBold' }]}>LIVE</Text>
                </View>
              )}
            </View>
            <Text style={[styles.bpmUnit, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>BPM</Text>
            {bt.vitals.heartRate !== undefined && (
              <View style={[styles.statusBadge, { backgroundColor: statusColor(hrStatus) + '20' }]}>
                <Text style={[styles.statusText, { color: statusColor(hrStatus), fontFamily: 'Inter_600SemiBold' }]}>
                  {hrStatus === 'normal' ? 'Normal' : hrStatus === 'warning' ? 'Elevated' : 'Critical'}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.vitalsGrid}>
          <VitalCard
            label="Blood Pressure"
            value={
              bt.vitals.systolicBP !== undefined && bt.vitals.diastolicBP !== undefined
                ? `${Math.round(bt.vitals.systolicBP)}/${Math.round(bt.vitals.diastolicBP)}`
                : '--'
            }
            unit={bt.vitals.systolicBP !== undefined ? 'mmHg' : ''}
            icon="speedometer-outline"
            status={bpStatus}
            C={C}
          />
          <VitalCard
            label="SpO2"
            value={bt.vitals.spo2 !== undefined ? `${Math.round(bt.vitals.spo2 * 10) / 10}` : '--'}
            unit={bt.vitals.spo2 !== undefined ? '%' : ''}
            icon="water-outline"
            status={spo2Status}
            C={C}
          />
          <VitalCard
            label="Temperature"
            value={bt.vitals.temperature !== undefined ? `${(Math.round(bt.vitals.temperature * 10) / 10).toFixed(1)}` : '--'}
            unit={bt.vitals.temperature !== undefined ? '°C' : ''}
            icon="thermometer-outline"
            status={tempStatus}
            C={C}
          />
          <VitalCard
            label="Status"
            value={isDeviceConnected ? getOverallStatus(hrStatus, bpStatus, spo2Status, tempStatus) : 'No Data'}
            unit=""
            icon="shield-checkmark-outline"
            status={isDeviceConnected ? getOverallStatusCode(hrStatus, bpStatus, spo2Status, tempStatus) : 'normal'}
            C={C}
          />
        </View>

        {hrHistory.length > 2 && (
          <View style={[styles.chartCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[styles.chartTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>
              Heart Rate Trend
            </Text>
            <MiniChart data={hrHistory} color={Colors.danger} />
          </View>
        )}

        <View style={[styles.alertCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
          <Text style={[styles.alertTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>
            Health Alerts
          </Text>
          {!isDeviceConnected ? (
            <View style={styles.alertRow}>
              <Ionicons name="bluetooth-outline" size={18} color={C.textMuted} />
              <Text style={[styles.alertText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Connect the ESP32 to see health alerts
              </Text>
            </View>
          ) : getAlerts(bt.vitals).length === 0 ? (
            <View style={styles.alertRow}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.secondary} />
              <Text style={[styles.alertText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                All vitals within normal range
              </Text>
            </View>
          ) : (
            getAlerts(bt.vitals).map((alert, i) => (
              <View key={i} style={styles.alertRow}>
                <Ionicons name="warning" size={18} color={alert.color} />
                <Text style={[styles.alertText, { color: alert.color, fontFamily: 'Inter_500Medium' }]}>
                  {alert.message}
                </Text>
              </View>
            ))
          )}
        </View>

        <FallDetectionCard onEmergency={handleEmergency} />

        <Animated.View style={emergencyStyle}>
          <Pressable
            style={({ pressed }) => [styles.emergencyBtn, { opacity: pressed ? 0.9 : 1 }]}
            onPress={handleEmergency}
          >
            <Ionicons name="warning" size={28} color="#fff" />
            <View>
              <Text style={[styles.emergencyTitle, { fontFamily: 'Inter_700Bold' }]}>EMERGENCY</Text>
              <Text style={[styles.emergencySub, { fontFamily: 'Inter_400Regular' }]}>
                Calls & texts your emergency contacts
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
      </ScrollView>

      {/* Emergency Confirmation Modal */}
      <Modal transparent animationType="fade" visible={showEmergency}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: C.card }]}>
            <View style={[styles.emergencyIconWrap, { backgroundColor: Colors.danger + '18' }]}>
              <Ionicons name="warning" size={40} color={Colors.danger} />
            </View>
            <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
              Activate Emergency?
            </Text>
            <Text style={[styles.modalText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
              This will immediately send your name, live vitals and GPS location to ALL your emergency contacts via SMS.
            </Text>
            <View style={[styles.emergencyInfoRow, { backgroundColor: Colors.danger + '10', borderColor: Colors.danger + '25' }]}>
              <Ionicons name="person" size={14} color={Colors.danger} />
              <Text style={[styles.emergencyInfoText, { color: Colors.danger, fontFamily: 'Inter_500Medium' }]}>
                {user?.name}  ·  {user?.uniqueId}
              </Text>
            </View>
            <View style={styles.modalBtns}>
              <Pressable style={[styles.modalCancel, { borderColor: C.cardBorder }]} onPress={() => setShowEmergency(false)}>
                <Text style={[styles.modalCancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={confirmEmergency} disabled={emergencyLoading}>
                {emergencyLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={[styles.modalConfirmText, { fontFamily: 'Inter_600SemiBold' }]}>Send Alerts</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Emergency Panel — shown after activation, lists all contacts */}
      <Modal transparent animationType="slide" visible={showEmergencyPanel}>
        <View style={[styles.emergencyPanelOverlay, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
          <View style={[styles.emergencyPanel, { backgroundColor: C.card }]}>
            <View style={[styles.emergencyPanelHeader, { backgroundColor: Colors.danger }]}>
              <Ionicons name="warning" size={22} color="#fff" />
              <Text style={[styles.emergencyPanelTitle, { fontFamily: 'Inter_700Bold' }]}>
                Emergency Activated
              </Text>
              <Pressable onPress={() => setShowEmergencyPanel(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
            </View>

            <View style={styles.emergencyPanelBody}>
              {/* Location info */}
              <View style={[styles.locationCard, { backgroundColor: Colors.danger + '10', borderColor: Colors.danger + '25' }]}>
                <Ionicons name="location" size={16} color={Colors.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locationLabel, { color: Colors.danger, fontFamily: 'Inter_600SemiBold' }]}>
                    Your Location
                  </Text>
                  <Text style={[styles.locationCoords, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                    {emergencyLocation}
                  </Text>
                </View>
                {emergencyMapsLink ? (
                  <Pressable onPress={() => Linking.openURL(emergencyMapsLink)} style={[styles.mapBtn, { backgroundColor: Colors.danger }]}>
                    <Text style={[styles.mapBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Map</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Status */}
              <Text style={[styles.contactsLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>
                {emergencyContacts.length === 0
                  ? 'No emergency contacts saved'
                  : `SMS opened for ${emergencyContacts.length} contact${emergencyContacts.length > 1 ? 's' : ''} — confirm send in your messages app`
                }
              </Text>

              {/* Contact list */}
              {emergencyContacts.length === 0 ? (
                <View style={[styles.noContactsCard, { backgroundColor: C.input, borderColor: C.cardBorder }]}>
                  <Ionicons name="person-add-outline" size={32} color={C.textMuted} />
                  <Text style={[styles.noContactsText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                    Add emergency contacts in your Profile tab
                  </Text>
                </View>
              ) : (
                emergencyContacts.map((contact: any, idx: number) => {
                  const phone = contact.phone?.replace(/[^+\d]/g, '') ?? '';
                  const sent = sentContacts.has(phone);
                  return (
                    <View key={idx} style={[styles.contactRow, { backgroundColor: sent ? Colors.secondary + '12' : C.input, borderColor: sent ? Colors.secondary + '35' : C.cardBorder }]}>
                      <View style={[styles.contactAvatar, { backgroundColor: sent ? Colors.secondary + '25' : Colors.danger + '18' }]}>
                        <Ionicons name={sent ? 'checkmark' : 'person'} size={18} color={sent ? Colors.secondary : Colors.danger} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.contactName, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>
                          {contact.name}
                          {contact.relation ? ` · ${contact.relation}` : ''}
                        </Text>
                        <Text style={[styles.contactPhone, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                          {contact.phone}
                        </Text>
                        {sent && (
                          <Text style={[styles.sentLabel, { color: Colors.secondary, fontFamily: 'Inter_500Medium' }]}>
                            SMS opened ✓
                          </Text>
                        )}
                      </View>
                      <View style={styles.contactActions}>
                        <Pressable style={[styles.contactActionBtn, { backgroundColor: Colors.primary + '18' }]} onPress={() => callContact(contact)}>
                          <Ionicons name="call" size={16} color={Colors.primary} />
                        </Pressable>
                        <Pressable style={[styles.contactActionBtn, { backgroundColor: Colors.secondary + '18' }]} onPress={() => smsContact(contact)}>
                          <Ionicons name="chatbubble" size={16} color={Colors.secondary} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}

              {/* 911 button always visible */}
              <Pressable style={[styles.call911Btn, { backgroundColor: Colors.danger }]} onPress={() => Linking.openURL('tel:911')}>
                <Ionicons name="call" size={20} color="#fff" />
                <Text style={[styles.call911Text, { fontFamily: 'Inter_700Bold' }]}>Call 911</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bluetooth Panel */}
      <Modal transparent animationType="slide" visible={showBluetooth} onRequestClose={() => setShowBluetooth(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowBluetooth(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: C.card }]} onPress={e => e.stopPropagation()}>
            <View style={styles.btHeader}>
              <Ionicons name="bluetooth" size={28} color={Colors.primary} />
              <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                Bluetooth Device
              </Text>
              <Pressable onPress={() => setShowBluetooth(false)} style={styles.btCloseBtn}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </Pressable>
            </View>

            {bt.isSupported ? (
              <>
                <Text style={[styles.modalText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                  {bt.status === 'connected'
                    ? `Connected to: ${bt.deviceName}\n\nReceiving live health data from your device.`
                    : bt.status === 'connecting'
                    ? 'Connecting to device…'
                    : bt.status === 'scanning'
                    ? bt.discoveredDevices.length === 0
                      ? 'Scanning for nearby BLE devices…\n\nMake sure your device is powered on.'
                      : `${bt.discoveredDevices.length} device${bt.discoveredDevices.length > 1 ? 's' : ''} found — tap to connect:`
                    : `Tap "Scan & Connect" to find your BLE health device.\n\nSupported: heart rate monitors, pulse oximeters, thermometers.`
                  }
                </Text>

                {/* Device list — searchable + scrollable, shown while scanning */}
                {bt.status === 'scanning' && bt.discoveredDevices.length > 0 && (
                  <BLEDevicePicker devices={bt.discoveredDevices} onSelect={bt.selectDevice} C={C} />
                )}

                {bt.status === 'connected' && (
                  <View style={[styles.btReadings, { borderColor: C.cardBorder }]}>
                    {bt.vitals.heartRate && (
                      <Text style={[styles.btReading, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>
                        ❤️  {bt.vitals.heartRate} BPM
                      </Text>
                    )}
                    {bt.vitals.spo2 && (
                      <Text style={[styles.btReading, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>
                        💧  {bt.vitals.spo2}% SpO2
                      </Text>
                    )}
                    {bt.vitals.temperature && (
                      <Text style={[styles.btReading, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>
                        🌡  {bt.vitals.temperature}°C
                      </Text>
                    )}
                    {!bt.vitals.heartRate && !bt.vitals.spo2 && !bt.vitals.temperature && (
                      <Text style={[styles.btReading, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                        Waiting for readings…
                      </Text>
                    )}
                  </View>
                )}

                {bt.error && (
                  <Text style={[styles.btError, { fontFamily: 'Inter_400Regular' }]}>{bt.error}</Text>
                )}

                <View style={styles.modalBtns}>
                  <Pressable
                    style={[styles.modalCancel, { borderColor: C.cardBorder }]}
                    onPress={() => setShowBluetooth(false)}
                  >
                    <Text style={[styles.modalCancelText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Close</Text>
                  </Pressable>

                  {bt.status === 'connected' ? (
                    <Pressable style={[styles.modalConfirm, { backgroundColor: Colors.warning }]} onPress={() => { bt.disconnect(); setShowBluetooth(false); }}>
                      <Text style={[styles.modalConfirmText, { fontFamily: 'Inter_600SemiBold' }]}>Disconnect</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.modalConfirm, { backgroundColor: Colors.primary }]}
                      onPress={() => bt.connect()}
                      disabled={bt.status === 'scanning' || bt.status === 'connecting'}
                    >
                      {bt.status === 'scanning' || bt.status === 'connecting'
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={[styles.modalConfirmText, { fontFamily: 'Inter_600SemiBold' }]}>Scan & Connect</Text>
                      }
                    </Pressable>
                  )}
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.modalText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                  Bluetooth is not available on this device or browser.{'\n\n'}
                  {'• '}Use the native Android APK for full BLE support{'\n'}
                  {'• '}On web, open in Chrome on Android or desktop{'\n'}
                  {'• '}Ensure your device is powered on and in pairing mode
                </Text>
                <Pressable
                  style={[styles.modalConfirm, { backgroundColor: Colors.primary, alignSelf: 'stretch' }]}
                  onPress={() => setShowBluetooth(false)}
                >
                  <Text style={[styles.modalConfirmText, { fontFamily: 'Inter_600SemiBold' }]}>Got it</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function VitalCard({ label, value, unit, icon, status, C }: any) {
  return (
    <View style={[styles.vitalCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
      <View style={[styles.vitalIconWrap, { backgroundColor: statusColor(status) + '18' }]}>
        <Ionicons name={icon} size={20} color={statusColor(status)} />
      </View>
      <Text style={[styles.vitalLabel, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <View style={styles.vitalValueRow}>
        <Text style={[styles.vitalValue, { color: C.text, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
        {unit ? <Text style={[styles.vitalUnit, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function MiniChart({ data, color }: { data: { value: number }[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.value));
  const min = Math.min(...data.map(d => d.value));
  const range = max - min || 1;
  const height = 56;
  return (
    <View style={styles.miniChart}>
      {data.map((d, i) => {
        const barHeight = Math.max(4, ((d.value - min) / range) * height);
        return (
          <View key={i} style={[styles.chartBar, { height: barHeight, backgroundColor: color, opacity: 0.3 + (i / data.length) * 0.7 }]} />
        );
      })}
    </View>
  );
}

// ── Searchable BLE device picker ─────────────────────────────────────────────
function BLEDevicePicker({ devices, onSelect, C }: { devices: { id: string; name: string | null }[]; onSelect: (id: string) => void; C: any }) {
  const [query, setQuery] = React.useState('');
  const filtered = query.trim()
    ? devices.filter(d => (d.name ?? 'Unknown Device').toLowerCase().includes(query.toLowerCase()) || d.id.toLowerCase().includes(query.toLowerCase()))
    : devices;

  return (
    <View style={{ width: '100%', gap: 8 }}>
      {/* Search bar */}
      <View style={[btPickerStyles.searchBar, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
        <Ionicons name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[btPickerStyles.searchInput, { color: C.text, fontFamily: 'Inter_400Regular' }]}
          placeholder="Filter by name…"
          placeholderTextColor={C.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Count label */}
      <Text style={[btPickerStyles.countLabel, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
        {filtered.length} of {devices.length} device{devices.length !== 1 ? 's' : ''} shown
      </Text>

      {/* Scrollable list */}
      <ScrollView
        style={btPickerStyles.list}
        contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <Text style={[btPickerStyles.noMatch, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
            No devices match "{query}"
          </Text>
        ) : (
          filtered.map(device => (
            <Pressable
              key={device.id}
              style={[btPickerStyles.row, { backgroundColor: C.input, borderColor: C.cardBorder }]}
              onPress={() => onSelect(device.id)}
            >
              <Ionicons name="bluetooth" size={18} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontFamily: 'Inter_500Medium', fontSize: 14 }} numberOfLines={1}>
                  {device.name || 'Unknown Device'}
                </Text>
                <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 11 }} numberOfLines={1}>
                  {device.id.slice(0, 22)}
                </Text>
              </View>
              <Text style={{ color: Colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
                Connect
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const btPickerStyles = StyleSheet.create({
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  countLabel: { fontSize: 12, textAlign: 'right' },
  list: { maxHeight: 220 },
  noMatch: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
});

function getTimeOfDay(h?: number) {
  const hour = h ?? new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function getAlerts(vitals: { heartRate?: number; systolicBP?: number; diastolicBP?: number; spo2?: number; temperature?: number }) {
  const alerts = [];
  if (vitals.heartRate !== undefined) {
    const s = getStatus('heartRate', vitals.heartRate);
    if (s !== 'normal') alerts.push({ message: `Heart rate ${s === 'danger' ? 'critical' : 'elevated'}: ${Math.round(vitals.heartRate)} BPM`, color: statusColor(s) });
  }
  if (vitals.systolicBP !== undefined && vitals.diastolicBP !== undefined) {
    const s = getStatus('systolicBP', vitals.systolicBP);
    if (s !== 'normal') alerts.push({ message: `Blood pressure ${s === 'danger' ? 'critical' : 'elevated'}: ${Math.round(vitals.systolicBP)}/${Math.round(vitals.diastolicBP)} mmHg`, color: statusColor(s) });
  }
  if (vitals.spo2 !== undefined) {
    const s = getStatus('spo2', vitals.spo2);
    if (s !== 'normal') alerts.push({ message: `Low oxygen saturation: ${Math.round(vitals.spo2)}%`, color: statusColor(s) });
  }
  if (vitals.temperature !== undefined) {
    const s = getStatus('temperature', vitals.temperature);
    if (s !== 'normal') alerts.push({ message: `Abnormal temperature: ${vitals.temperature.toFixed(1)}°C`, color: statusColor(s) });
  }
  return alerts;
}

function getOverallStatus(a: string, b: string, c: string, d: string) {
  const all = [a, b, c, d];
  if (all.includes('danger')) return 'Critical';
  if (all.includes('warning')) return 'Caution';
  return 'Healthy';
}

function getOverallStatusCode(a: string, b: string, c: string, d: string) {
  const all = [a, b, c, d];
  if (all.includes('danger')) return 'danger';
  if (all.includes('warning')) return 'warning';
  return 'normal';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  greeting: { fontSize: 13, marginBottom: 2 },
  userName: { fontSize: 24, letterSpacing: -0.3 },
  idBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  idText: { fontSize: 12 },
  syncRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginBottom: 20, gap: 8 },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  syncText: { flex: 1, fontSize: 12 },
  heartSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 20 },
  heartCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  heartInfo: { flex: 1 },
  bpmRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bpmValue: { fontSize: 52, lineHeight: 56, letterSpacing: -2 },
  bpmUnit: { fontSize: 16 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#22c55e18', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 6, borderWidth: 1, borderColor: '#22c55e40' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  liveText: { fontSize: 10, color: '#22c55e', letterSpacing: 0.5 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 4 },
  statusText: { fontSize: 12 },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  vitalCard: { width: '47%', padding: 16, borderRadius: 16, borderWidth: 1, gap: 8 },
  vitalIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  vitalLabel: { fontSize: 12 },
  vitalValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  vitalValue: { fontSize: 22, letterSpacing: -0.5 },
  vitalUnit: { fontSize: 12 },
  chartCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
  chartTitle: { fontSize: 14, marginBottom: 12 },
  miniChart: { flexDirection: 'row', alignItems: 'flex-end', height: 56, gap: 3 },
  chartBar: { flex: 1, borderRadius: 3 },
  alertCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20, gap: 10 },
  alertTitle: { fontSize: 14, marginBottom: 4 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertText: { fontSize: 13, flex: 1 },
  emergencyBtn: {
    backgroundColor: Colors.danger,
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  emergencyTitle: { color: '#fff', fontSize: 18 },
  emergencySub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 20, padding: 24, alignItems: 'center', gap: 14, width: '100%', maxWidth: 420 },
  btHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  btCloseBtn: { marginLeft: 'auto', padding: 4 },
  deviceListScroll: { width: '100%', maxHeight: 260 },
  modalTitle: { fontSize: 22 },
  modalText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 15 },
  modalConfirm: { flex: 1, height: 48, borderRadius: 12, backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center' },
  modalConfirmText: { color: '#fff', fontSize: 15 },
  btReadings: { width: '100%', borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  btReading: { fontSize: 15 },
  btError: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  // Emergency modal extras
  emergencyIconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emergencyInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, width: '100%' },
  emergencyInfoText: { fontSize: 13 },
  // Emergency panel
  emergencyPanelOverlay: { flex: 1, justifyContent: 'flex-end' },
  emergencyPanel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', maxHeight: '88%' },
  emergencyPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  emergencyPanelTitle: { color: '#fff', fontSize: 17 },
  emergencyPanelBody: { padding: 20, gap: 14 },
  locationCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  locationLabel: { fontSize: 13, marginBottom: 2 },
  locationCoords: { fontSize: 12 },
  mapBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  mapBtnText: { color: '#fff', fontSize: 12 },
  contactsLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  noContactsCard: { alignItems: 'center', padding: 24, borderRadius: 14, borderWidth: 1, gap: 10 },
  noContactsText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  contactAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  contactName: { fontSize: 15 },
  contactPhone: { fontSize: 12, marginTop: 1 },
  sentLabel: { fontSize: 11, marginTop: 2 },
  contactActions: { flexDirection: 'row', gap: 8 },
  contactActionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  call911Btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 16, marginTop: 4 },
  call911Text: { color: '#fff', fontSize: 17 },
});
