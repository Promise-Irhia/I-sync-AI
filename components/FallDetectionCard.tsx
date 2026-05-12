import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, ActivityIndicator, Platform,
  useColorScheme, Animated, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl } from '@/lib/query-client';
import { useBluetoothAccelerometer, type BLEAccelData } from '@/hooks/useBluetoothAccelerometer';

let Accelerometer: any = null;
if (Platform.OS !== 'web') {
  Accelerometer = require('expo-sensors').Accelerometer;
}
let CameraView: any = null;
let CameraModule: any = null;
if (Platform.OS !== 'web') {
  CameraModule = require('expo-camera');
  CameraView = CameraModule.CameraView;
}

const G = 9.81;
const SENSITIVITIES = {
  low:    { label: 'Low',  impact: 3.5, freefall: 0.4 },
  medium: { label: 'Med', impact: 2.5, freefall: 0.5 },
  high:   { label: 'High', impact: 2.0, freefall: 0.6 },
};
type Sensitivity = keyof typeof SENSITIVITIES;
type AccelPoint  = { x: number; y: number; z: number; magnitude: number; t: number };
type VerifyResult = { result: 'fall_confirmed' | 'false_alarm'; confidence: number; reason: string; analysisMode?: string; smsSent?: boolean };

function normalize(v: number) { return Platform.OS === 'android' ? v / G : v; }
function calcMag(x: number, y: number, z: number) {
  return Math.sqrt(normalize(x) ** 2 + normalize(y) ** 2 + normalize(z) ** 2);
}

const BUFFER_SIZE = 40; // ~4 seconds at 10 Hz

export default function FallDetectionCard({ onEmergency }: { onEmergency?: () => void }) {
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader } = useAuth();
  const base = getApiUrl();

  const [source, setSource] = useState<'phone' | 'ble'>('phone');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState<'idle' | 'alert' | 'camera' | 'result'>('idle');
  const [countdown, setCountdown] = useState(10);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [camGranted, setCamGranted] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [autoCaptureTick, setAutoCaptureTick] = useState<number | null>(null);
  const [lastMag, setLastMag] = useState<number | null>(null);
  const [magHistory, setMagHistory] = useState<number[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  function updateMag(mag: number) {
    setLastMag(mag);
    setMagHistory(prev => [...prev.slice(-19), mag]);
  }

  // Pulse the signal dot when BLE data arrives
  function triggerPulse() {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.6, duration: 120, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }

  // Circular acceleration buffer — keeps last BUFFER_SIZE readings for backend analysis
  const accelBufferRef = useRef<AccelPoint[]>([]);

  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const fallWindowRef = useRef<{ type: 'freefall' | 'impact' | null; time: number }>({ type: null, time: 0 });
  const modeRef = useRef(mode);
  const sensRef = useRef(sensitivity);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraRef = useRef<any>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { sensRef.current = sensitivity; }, [sensitivity]);

  // Pre-check camera permission at mount so camGranted is ready when needed
  useEffect(() => {
    if (Platform.OS === 'web' || !CameraModule) return;
    CameraModule.getCameraPermissionsAsync?.()
      .then((result: { status: string }) => {
        if (result.status === 'granted') setCamGranted(true);
      })
      .catch(() => {});
  }, []);

  // Auto-capture sequence: 1s warmup → 3-2-1 countdown → take photo automatically
  const autoVerifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCaptureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoCaptureTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (mode === 'camera') {
      setCameraReady(false);
      setAutoCaptureTick(null);
      autoCaptureTickRef.current = null;

      // Phase 1: 1 second warmup for camera hardware
      autoVerifyTimerRef.current = setTimeout(() => {
        setCameraReady(true);
        // Phase 2: start 3-2-1 countdown
        setAutoCaptureTick(3);
        autoCaptureTickRef.current = 3;
        autoCaptureIntervalRef.current = setInterval(() => {
          autoCaptureTickRef.current = (autoCaptureTickRef.current ?? 1) - 1;
          setAutoCaptureTick(autoCaptureTickRef.current);
          if (autoCaptureTickRef.current <= 0) {
            clearInterval(autoCaptureIntervalRef.current!);
            autoCaptureIntervalRef.current = null;
            // Auto-capture fires here — modeRef check prevents double-trigger
            if (modeRef.current === 'camera') {
              takePhotoAndVerify();
            }
          }
        }, 1000);
      }, 1000);
    } else {
      if (autoVerifyTimerRef.current) { clearTimeout(autoVerifyTimerRef.current); autoVerifyTimerRef.current = null; }
      if (autoCaptureIntervalRef.current) { clearInterval(autoCaptureIntervalRef.current); autoCaptureIntervalRef.current = null; }
      setCameraReady(false);
      setAutoCaptureTick(null);
      autoCaptureTickRef.current = null;
    }
    return () => {
      if (autoVerifyTimerRef.current) { clearTimeout(autoVerifyTimerRef.current); autoVerifyTimerRef.current = null; }
      if (autoCaptureIntervalRef.current) { clearInterval(autoCaptureIntervalRef.current); autoCaptureIntervalRef.current = null; }
    };
  }, [mode]);

  // BLE accelerometer hook
  const ble = useBluetoothAccelerometer(useCallback((data: BLEAccelData) => {
    updateMag(data.magnitude);
    triggerPulse();
    if (!isActive || modeRef.current !== 'idle') return;
    pushPoint(data.x, data.y, data.z, data.magnitude);
    runFallAlgorithm(data.magnitude, data);
  }, [isActive]));

  function pushPoint(x: number, y: number, z: number, magnitude: number) {
    const pt: AccelPoint = { x, y, z, magnitude, t: Date.now() };
    accelBufferRef.current = [...accelBufferRef.current, pt].slice(-BUFFER_SIZE);
  }

  function runFallAlgorithm(mag: number, raw: { x: number; y: number; z: number; magnitude: number }) {
    if (modeRef.current !== 'idle') return;
    const thresh = SENSITIVITIES[sensRef.current];
    const win = fallWindowRef.current;
    const now = Date.now();
    if (mag < thresh.freefall && win.type !== 'freefall') {
      fallWindowRef.current = { type: 'freefall', time: now };
    } else if (mag > thresh.impact && win.type === 'freefall' && now - win.time < 2500) {
      fallWindowRef.current = { type: null, time: 0 };
      triggerFallAlert(raw);
    } else if (now - win.time > 3000) {
      fallWindowRef.current = { type: null, time: 0 };
    }
  }

  function startMonitoring() {
    if (source === 'ble') {
      // BLE monitoring — data comes via the hook callback above
      setIsActive(true);
      return;
    }
    if (Platform.OS === 'web' || !Accelerometer) return;
    if (accelSubRef.current) accelSubRef.current.remove();
    Accelerometer.setUpdateInterval(100);
    accelSubRef.current = Accelerometer.addListener((d: { x: number; y: number; z: number }) => {
      const mag = calcMag(d.x, d.y, d.z);
      pushPoint(d.x, d.y, d.z, mag);
      updateMag(mag);
      runFallAlgorithm(mag, { x: d.x, y: d.y, z: d.z, magnitude: mag });
    });
    setIsActive(true);
  }

  function stopMonitoring() {
    accelSubRef.current?.remove();
    accelSubRef.current = null;
    setIsActive(false);
    setLastMag(null);
    setMagHistory([]);
    fallWindowRef.current = { type: null, time: 0 };
  }

  async function triggerFallAlert(data: { x: number; y: number; z: number; magnitude: number }) {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setCountdown(10);
    setMode('alert');
    modeRef.current = 'alert';
    try {
      let lat: number | undefined, lng: number | undefined;
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
      }
      const res = await fetch(`${base}api/patient/fall-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          accelerationX: data.x, accelerationY: data.y, accelerationZ: data.z,
          magnitude: data.magnitude,
          locationLat: lat, locationLng: lng,
          source, bleDeviceName: ble.deviceName,
        }),
      });
      const json = await res.json();
      if (json.eventId) setPendingEventId(json.eventId);
    } catch {}
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          if (modeRef.current === 'alert') openCamera();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function cancelAlert() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (pendingEventId) {
      fetch(`${base}api/patient/fall-events/${pendingEventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ status: 'cancelled' }),
      }).catch(() => {});
    }
    setPendingEventId(null);
    setMode('idle');
    modeRef.current = 'idle';
  }

  async function openCamera() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (Platform.OS === 'web') { await verifyWithoutCamera(); return; }
    // Request permission if not already granted
    if (!camGranted && CameraModule) {
      try {
        const { status } = await CameraModule.requestCameraPermissionsAsync();
        setCamGranted(status === 'granted');
      } catch {}
    }
    setMode('camera');
    modeRef.current = 'camera';
  }

  function cancelAutoCapture() {
    if (autoCaptureIntervalRef.current) { clearInterval(autoCaptureIntervalRef.current); autoCaptureIntervalRef.current = null; }
    setAutoCaptureTick(null);
    autoCaptureTickRef.current = null;
  }

  async function takePhotoAndVerify() {
    cancelAutoCapture();
    if (!cameraRef.current) { await sendForVerification(''); return; }
    setIsVerifying(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      await sendForVerification(photo.base64 || '');
    } catch { await sendForVerification(''); }
    setIsVerifying(false);
  }

  async function verifyWithoutCamera() {
    setIsVerifying(true);
    await sendForVerification('');
    setIsVerifying(false);
  }

  async function sendForVerification(base64: string) {
    setMode('result');
    modeRef.current = 'result';
    const snapshot = [...accelBufferRef.current];
    try {
      // Load emergency contacts from local storage so the server can SMS them
      let emergencyContacts: any[] = [];
      try {
        const stored = await AsyncStorage.getItem('isync_emergency_contacts');
        if (stored) emergencyContacts = JSON.parse(stored);
      } catch {}

      const res = await fetch(`${base}api/patient/verify-fall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          image: base64,
          eventId: pendingEventId,
          accelerationHistory: snapshot,
          source,
          bleDeviceName: ble.deviceName,
          emergencyContacts,
        }),
      });
      const data = await res.json();
      setVerifyResult(data);
      if (data.result === 'fall_confirmed') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      setVerifyResult({ result: 'fall_confirmed', confidence: 70, reason: 'Could not verify — defaulting to confirmed for safety.' });
    }
  }

  function resetToIdle() {
    setPendingEventId(null);
    setVerifyResult(null);
    setIsVerifying(false);
    setCameraReady(false);
    setMode('idle');
    modeRef.current = 'idle';
  }

  const isWeb = Platform.OS === 'web';
  const confirmed = verifyResult?.result === 'fall_confirmed';

  function analysisLabel(mode?: string) {
    if (mode === 'camera+motion') return 'Camera + Motion';
    if (mode === 'motion-only') return 'Motion Pattern';
    if (mode === 'camera') return 'Camera';
    return 'AI';
  }

  return (
    <>
      {/* ── Compact Card ── */}
      <View style={[styles.card, { backgroundColor: C.card, borderColor: isActive ? Colors.danger + '50' : C.cardBorder }]}>

        {/* Header row */}
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: (isActive ? Colors.danger : Colors.primary) + '18' }]}>
            <Ionicons name="shield-checkmark" size={20} color={isActive ? Colors.danger : Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Fall Detection</Text>
            <Text style={[styles.cardSub, { color: isActive ? '#10B981' : C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              {isWeb
                ? 'Phone sensor requires Expo Go · BLE works on Chrome'
                : isActive
                  ? `● Monitoring via ${source === 'ble' ? (ble.deviceName ?? 'BLE device') : 'phone sensor'}`
                  : '○ Inactive'}
            </Text>
          </View>
          <Pressable
            style={[styles.toggleBtn, {
              backgroundColor: isActive ? Colors.danger + '15' : Colors.secondary + '15',
              borderColor: isActive ? Colors.danger + '40' : Colors.secondary + '40',
            }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              isActive ? stopMonitoring() : startMonitoring();
            }}
          >
            <Ionicons name={isActive ? 'stop-circle' : 'play-circle'} size={18} color={isActive ? Colors.danger : Colors.secondary} />
            <Text style={[styles.toggleText, { color: isActive ? Colors.danger : Colors.secondary, fontFamily: 'Inter_600SemiBold' }]}>
              {isActive ? 'Stop' : 'Start'}
            </Text>
          </Pressable>
        </View>

        {/* Watch connection status badge — compact, no picker */}
        {!isWeb && (
          <View style={[styles.watchBadge, {
            backgroundColor: ble.status === 'connected' ? '#10B981' + '15' : C.input,
            borderColor: ble.status === 'connected' ? '#10B981' + '40' : C.inputBorder,
          }]}>
            <Animated.View style={ble.status === 'connected' ? [styles.blePulseDot, { transform: [{ scale: pulseAnim }] }] : undefined}>
              <Ionicons name="bluetooth" size={14} color={ble.status === 'connected' ? '#10B981' : C.textMuted} />
            </Animated.View>
            <Text style={[styles.watchBadgeText, { color: ble.status === 'connected' ? '#10B981' : C.textMuted, fontFamily: 'Inter_500Medium' }]}>
              {ble.status === 'connected'
                ? `Watch connected · ${ble.deviceName ?? 'BLE device'}`
                : ble.status === 'scanning' ? 'Scanning for watch…'
                : ble.status === 'connecting' ? 'Connecting…'
                : 'Watch not connected — use the Bluetooth button above'}
            </Text>
            {ble.status === 'connected' && (
              <Pressable onPress={() => { ble.disconnect(); setLastMag(null); }} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={Colors.danger + 'AA'} />
              </Pressable>
            )}
          </View>
        )}

        {/* Sensitivity selector */}
        {(!isWeb || source === 'ble') && (
          <View style={styles.sensRow}>
            {(Object.keys(SENSITIVITIES) as Sensitivity[]).map(key => {
              const sel = sensitivity === key;
              return (
                <Pressable
                  key={key}
                  style={[styles.sensBtn, {
                    backgroundColor: sel ? Colors.primary + '20' : C.input,
                    borderColor: sel ? Colors.primary : C.inputBorder,
                  }]}
                  onPress={() => setSensitivity(key)}
                >
                  <Text style={[styles.sensBtnText, { color: sel ? Colors.primary : C.textMuted, fontFamily: sel ? 'Inter_700Bold' : 'Inter_400Regular' }]}>
                    {SENSITIVITIES[key].label}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={[styles.sensHint, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              sensitivity
            </Text>
          </View>
        )}

        {/* ── Live G-Force Bar Graph ── */}
        {isActive && !isWeb && mode === 'idle' && (
          <View style={[styles.gforceWrap, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
            {/* Header row */}
            <View style={styles.gforceHeader}>
              <Text style={[styles.gforceLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>
                Live G-Force
              </Text>
              {lastMag !== null ? (
                <View style={[styles.gforceBadge, {
                  backgroundColor:
                    lastMag > SENSITIVITIES[sensitivity].impact ? Colors.danger + '25' :
                    lastMag < SENSITIVITIES[sensitivity].freefall ? Colors.warning + '25' :
                    '#10B981' + '20',
                }]}>
                  <Text style={[styles.gforceBadgeText, {
                    color:
                      lastMag > SENSITIVITIES[sensitivity].impact ? Colors.danger :
                      lastMag < SENSITIVITIES[sensitivity].freefall ? Colors.warning :
                      '#10B981',
                    fontFamily: 'Inter_700Bold',
                  }]}>
                    {lastMag.toFixed(2)}g
                  </Text>
                </View>
              ) : (
                <Text style={[styles.gforceLabel, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>—</Text>
              )}
            </View>

            {/* Bar track with threshold ticks */}
            <View style={styles.gforceTrackRow}>
              <View style={[styles.gforceTrack, { backgroundColor: C.cardBorder }]}>
                {/* Filled bar */}
                {lastMag !== null && (
                  <View style={[styles.gforceFill, {
                    width: `${Math.min(100, (lastMag / 5) * 100)}%`,
                    backgroundColor:
                      lastMag > SENSITIVITIES[sensitivity].impact ? Colors.danger :
                      lastMag < SENSITIVITIES[sensitivity].freefall ? Colors.warning :
                      '#10B981',
                  }]} />
                )}
                {/* Freefall threshold tick */}
                <View style={[styles.gforceTick, {
                  left: `${(SENSITIVITIES[sensitivity].freefall / 5) * 100}%`,
                  backgroundColor: Colors.warning,
                }]} />
                {/* Impact threshold tick */}
                <View style={[styles.gforceTick, {
                  left: `${(SENSITIVITIES[sensitivity].impact / 5) * 100}%`,
                  backgroundColor: Colors.danger,
                }]} />
              </View>
            </View>

            {/* Scale labels */}
            <View style={styles.gforceScaleRow}>
              <Text style={[styles.gforceScaleText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>0g</Text>
              <Text style={[styles.gforceScaleText, { color: Colors.warning, fontFamily: 'Inter_500Medium', left: `${(SENSITIVITIES[sensitivity].freefall / 5) * 100}%`, position: 'absolute', transform: [{ translateX: -8 }] }]}>
                {SENSITIVITIES[sensitivity].freefall}g
              </Text>
              <Text style={[styles.gforceScaleText, { color: Colors.danger, fontFamily: 'Inter_500Medium', left: `${(SENSITIVITIES[sensitivity].impact / 5) * 100}%`, position: 'absolute', transform: [{ translateX: -8 }] }]}>
                {SENSITIVITIES[sensitivity].impact}g
              </Text>
              <Text style={[styles.gforceScaleText, { color: C.textMuted, fontFamily: 'Inter_400Regular', marginLeft: 'auto' }]}>5g</Text>
            </View>

            {/* Sparkline — last 20 samples */}
            {magHistory.length > 1 && (
              <View style={styles.sparkline}>
                {magHistory.map((v, i) => {
                  const h = Math.min(100, (v / 5) * 100);
                  const color =
                    v > SENSITIVITIES[sensitivity].impact ? Colors.danger :
                    v < SENSITIVITIES[sensitivity].freefall ? Colors.warning :
                    '#10B981';
                  return (
                    <View key={i} style={[styles.sparkBar, { height: `${Math.max(4, h)}%`, backgroundColor: color + 'CC' }]} />
                  );
                })}
              </View>
            )}

            {/* Zone legend */}
            <View style={styles.gforceLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                <Text style={[styles.legendText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>Normal</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: Colors.warning }]} />
                <Text style={[styles.legendText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>Freefall</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: Colors.danger }]} />
                <Text style={[styles.legendText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>Impact</Text>
              </View>
            </View>
          </View>
        )}

        {/* Simulate button — always visible when idle, for testing in Expo Go */}
        {mode === 'idle' && (
          <Pressable
            style={[styles.simulateBtn, { borderColor: Colors.warning + '60', backgroundColor: Colors.warning + '12' }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              const now = Date.now();
              const fakePts: AccelPoint[] = [
                ...Array(10).fill(null).map((_, i) => ({ x: 0.02, y: 0.03, z: 0.98, magnitude: 1.0, t: now - (20 - i) * 100 })),
                { x: 0.01, y: 0.02, z: 0.28, magnitude: 0.28, t: now - 1000 },
                { x: 0.01, y: 0.01, z: 0.22, magnitude: 0.22, t: now - 900 },
                { x: 0.80, y: 1.20, z: 3.50, magnitude: 3.80, t: now - 800 },
                { x: 0.40, y: 0.60, z: 1.10, magnitude: 1.32, t: now - 700 },
                { x: 0.20, y: 0.30, z: 0.90, magnitude: 0.98, t: now - 600 },
              ];
              accelBufferRef.current = fakePts;
              triggerFallAlert({ x: 0.80, y: 1.20, z: 3.50, magnitude: 3.80 });
            }}
          >
            <Ionicons name="flash-outline" size={14} color={Colors.warning} />
            <Text style={[styles.simulateBtnText, { color: Colors.warning, fontFamily: 'Inter_600SemiBold' }]}>
              Simulate Fall
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Fall Alert Modal ── */}
      <Modal visible={mode === 'alert'} animationType="fade" transparent={false}>
        <View style={styles.alertScreen}>
          <View style={styles.alertIconWrap}>
            <Ionicons name="warning" size={64} color="#fff" />
          </View>
          <Text style={[styles.alertTitle, { fontFamily: 'Inter_700Bold' }]}>Fall Detected</Text>
          <Text style={[styles.alertSub, { fontFamily: 'Inter_400Regular' }]}>
            {source === 'ble'
              ? `Signal from ${ble.deviceName ?? 'BLE device'} — are you okay?`
              : 'Motion sensor detected a fall — are you okay?'}
          </Text>
          <View style={styles.countdownRing}>
            <Text style={[styles.countdownNum, { fontFamily: 'Inter_700Bold' }]}>{countdown}</Text>
            <Text style={[styles.countdownLabel, { fontFamily: 'Inter_400Regular' }]}>seconds</Text>
          </View>
          <Pressable style={styles.cancelBtn} onPress={cancelAlert}>
            <Ionicons name="checkmark-circle" size={22} color="#fff" />
            <Text style={[styles.cancelBtnText, { fontFamily: 'Inter_700Bold' }]}>I'm OK — Cancel</Text>
          </Pressable>
          <Text style={[styles.alertFooter, { fontFamily: 'Inter_400Regular' }]}>
            Camera + motion data sent for AI verification
          </Text>
        </View>
      </Modal>

      {/* ── Camera Modal ── */}
      <Modal visible={mode === 'camera'} animationType="slide">
        <View style={[styles.cameraScreen, { backgroundColor: '#000' }]}>
          {CameraView && camGranted ? (
            <>
              <CameraView ref={cameraRef} style={styles.cameraView} facing="front">
                {/* Auto-capture countdown ring — shown when camera is live and counting down */}
                {cameraReady && autoCaptureTick !== null && (
                  <View style={styles.autoCaptureOverlay}>
                    <View style={styles.autoCaptureRing}>
                      <Text style={[styles.autoCaptureNum, { fontFamily: 'Inter_700Bold' }]}>
                        {autoCaptureTick}
                      </Text>
                    </View>
                    <Text style={[styles.autoCaptureLabel, { fontFamily: 'Inter_400Regular' }]}>
                      Auto-capturing…
                    </Text>
                    <Pressable style={styles.cancelAutoBtn} onPress={cancelAutoCapture}>
                      <Text style={[styles.cancelAutoText, { fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
                {cameraReady && autoCaptureTick === null && (
                  <View style={styles.cameraOverlay}>
                    <Text style={[styles.cameraTitle, { fontFamily: 'Inter_700Bold' }]}>Fall Verification</Text>
                    <Text style={[styles.cameraSub, { fontFamily: 'Inter_400Regular' }]}>
                      Tap below to capture manually
                    </Text>
                  </View>
                )}
              </CameraView>
              {/* Initialising overlay — covers black flash while camera warms up */}
              {!cameraReady && (
                <View style={styles.cameraInitOverlay}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={[styles.cameraInitText, { fontFamily: 'Inter_600SemiBold' }]}>
                    Starting camera…
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.noCameraWrap}>
              <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.5)" />
              <Text style={[styles.noCameraText, { fontFamily: 'Inter_400Regular' }]}>
                {!camGranted
                  ? 'Camera permission not granted — motion data will still be analysed'
                  : 'Camera unavailable — motion data will still be analysed'}
              </Text>
              <Pressable
                style={[styles.captureBtn, { marginTop: 24, paddingHorizontal: 24 }]}
                onPress={() => sendForVerification('')}
              >
                <Text style={[styles.captureBtnText, { fontFamily: 'Inter_700Bold' }]}>Analyse Motion Data</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.cameraActions}>
            <Pressable
              style={[styles.captureBtn, (isVerifying || !cameraReady) && { opacity: 0.5 }]}
              onPress={takePhotoAndVerify}
              disabled={isVerifying || !cameraReady}
            >
              {isVerifying
                ? <ActivityIndicator color="#000" />
                : <Text style={[styles.captureBtnText, { fontFamily: 'Inter_700Bold' }]}>
                    {!cameraReady ? 'Starting camera…' : 'Capture Now'}
                  </Text>
              }
            </Pressable>
            <Pressable style={styles.skipBtn} onPress={() => { cancelAutoCapture(); sendForVerification(''); }}>
              <Text style={[styles.skipBtnText, { fontFamily: 'Inter_400Regular' }]}>Skip — Use Motion Data Only</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Result Modal ── */}
      <Modal visible={mode === 'result'} animationType="fade" transparent={false}>
        <View style={[styles.resultScreen, { backgroundColor: confirmed ? Colors.danger : '#10B981' }]}>
          {isVerifying ? (
            <>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={[styles.resultTitle, { fontFamily: 'Inter_700Bold' }]}>Analysing…</Text>
              <Text style={[styles.resultSub, { fontFamily: 'Inter_400Regular' }]}>
                Running {verifyResult?.analysisMode ? analysisLabel(verifyResult.analysisMode) : 'AI'} verification
              </Text>
            </>
          ) : verifyResult ? (
            <>
              <Ionicons name={confirmed ? 'warning' : 'checkmark-circle'} size={72} color="#fff" />
              <Text style={[styles.resultTitle, { fontFamily: 'Inter_700Bold' }]}>
                {confirmed ? 'Fall Confirmed' : 'False Alarm'}
              </Text>
              <Text style={[styles.resultSub, { fontFamily: 'Inter_400Regular' }]}>
                {verifyResult.reason}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.confidenceBadge}>
                  <Text style={[styles.badgeText, { fontFamily: 'Inter_600SemiBold' }]}>
                    {verifyResult.confidence}% confidence
                  </Text>
                </View>
                {verifyResult.analysisMode && (
                  <View style={[styles.confidenceBadge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                    <Text style={[styles.badgeText, { fontFamily: 'Inter_600SemiBold' }]}>
                      {analysisLabel(verifyResult.analysisMode)} analysis
                    </Text>
                  </View>
                )}
              </View>
              {confirmed && (
                <>
                  {verifyResult?.smsSent ? (
                    <View style={styles.smsSentBadge}>
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={[styles.smsSentText, { fontFamily: 'Inter_600SemiBold' }]}>
                        SMS sent to emergency contacts
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    style={styles.emergencyResultBtn}
                    onPress={() => { resetToIdle(); onEmergency?.(); }}
                  >
                    <Ionicons name="warning" size={20} color="#fff" />
                    <Text style={[styles.emergencyResultText, { fontFamily: 'Inter_700Bold' }]}>
                      Alert Emergency Contacts
                    </Text>
                  </Pressable>
                </>
              )}
              <Pressable style={styles.dismissBtn} onPress={resetToIdle}>
                <Text style={[styles.dismissText, { fontFamily: 'Inter_600SemiBold' }]}>
                  {confirmed ? 'Dismiss' : 'Got it'}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15 },
  cardSub: { fontSize: 12, marginTop: 2 },
  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  toggleText: { fontSize: 13 },
  sourceRow: { flexDirection: 'row', gap: 8 },
  sourceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  sourceBtnText: { fontSize: 12 },
  blePanel: { borderRadius: 14, borderWidth: 1, padding: 16, overflow: 'hidden' },
  bleConnectedWrap: { gap: 12 },
  bleConnectedTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  blePulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981' },
  bleDeviceName: { fontSize: 15 },
  bleStatusLabel: { fontSize: 12, marginTop: 1 },
  bleDisconnectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  bleDisconnectText: { fontSize: 12 },
  bleSignalWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bleSignalLabel: { fontSize: 11, width: 62 },
  bleSignalBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  bleSignalFill: { height: 6, borderRadius: 3 },
  bleSignalValue: { fontSize: 11, width: 36, textAlign: 'right' },
  bleCenteredState: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  bleIdleIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  bleUnsupportedIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  bleBigStatus: { fontSize: 15, textAlign: 'center' },
  bleSubStatus: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  bleErrorMsg: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  bleScanBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
    marginTop: 4,
  },
  bleScanBtnText: { color: '#fff', fontSize: 15 },
  bleScanHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  bleCancelScan: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  bleDeviceList: { width: '100%', maxHeight: 220 },
  watchBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  watchBadgeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  bleDeviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  bleDeviceRowName: { flex: 1, fontSize: 13 },
  sensRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sensBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  sensBtnText: { fontSize: 12 },
  sensHint: { fontSize: 11, flex: 1 },
  simulateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed',
  },
  simulateBtnText: { fontSize: 13 },
  gforceWrap: {
    borderRadius: 12, borderWidth: 1, padding: 12, gap: 8,
  },
  gforceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gforceLabel: { fontSize: 12 },
  gforceBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  gforceBadgeText: { fontSize: 13 },
  gforceTrackRow: { height: 12, justifyContent: 'center' },
  gforceTrack: { height: 10, borderRadius: 5, overflow: 'hidden', position: 'relative' },
  gforceFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  gforceTick: { position: 'absolute', top: 0, bottom: 0, width: 2, borderRadius: 1 },
  gforceScaleRow: {
    flexDirection: 'row', alignItems: 'center',
    position: 'relative', height: 16,
  },
  gforceScaleText: { fontSize: 10 },
  sparkline: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 32, gap: 2, marginTop: 2,
  },
  sparkBar: { flex: 1, borderRadius: 2, minHeight: 2 },
  gforceLegend: { flexDirection: 'row', gap: 12, marginTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 10 },
  alertScreen: {
    flex: 1, backgroundColor: Colors.danger,
    alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16,
  },
  alertIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { color: '#fff', fontSize: 32, textAlign: 'center' },
  alertSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  countdownRing: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  countdownNum: { color: '#fff', fontSize: 48 },
  countdownLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16, paddingHorizontal: 28, paddingVertical: 16,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  cancelBtnText: { color: '#fff', fontSize: 18 },
  alertFooter: { color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center' },
  cameraScreen: { flex: 1 },
  cameraView: { flex: 1 },
  cameraOverlay: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', gap: 8 },
  cameraTitle: {
    color: '#fff', fontSize: 22,
    textShadowColor: '#000', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 },
  },
  cameraSub: {
    color: 'rgba(255,255,255,0.8)', fontSize: 14,
    textShadowColor: '#000', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 },
  },
  noCameraWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  noCameraText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  cameraInitOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  cameraInitText: { color: '#fff', fontSize: 16 },
  autoCaptureOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  autoCaptureRing: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 4, borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  autoCaptureNum: { color: '#fff', fontSize: 52, lineHeight: 58 },
  autoCaptureLabel: { color: '#fff', fontSize: 15 },
  cancelAutoBtn: {
    marginTop: 6, paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cancelAutoText: { color: '#fff', fontSize: 14 },
  cameraActions: { padding: 24, gap: 12, backgroundColor: 'rgba(0,0,0,0.7)' },
  captureBtn: { backgroundColor: '#fff', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  captureBtnText: { color: '#000', fontSize: 16 },
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  resultScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  resultTitle: { color: '#fff', fontSize: 30, textAlign: 'center' },
  resultSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  confidenceBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  badgeText: { color: '#fff', fontSize: 13 },
  smsSentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  smsSentText: { color: '#fff', fontSize: 13 },
  emergencyResultBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8,
  },
  emergencyResultText: { color: '#fff', fontSize: 16 },
  dismissBtn: { paddingHorizontal: 32, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12 },
  dismissText: { color: '#fff', fontSize: 15 },
});
