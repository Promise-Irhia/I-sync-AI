import React, {
  createContext, useContext, useRef, useState, useEffect, useCallback, ReactNode,
} from 'react';
import { Platform, Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl } from '@/lib/query-client';
import { useBLE } from '@/context/BLEContext';
import { Ionicons } from '@expo/vector-icons';

let Accelerometer: any = null;
if (Platform.OS !== 'web') {
  Accelerometer = require('expo-sensors').Accelerometer;
}

const G = 9.81;

const CORRELATION_WINDOW_MS = 3000;

export const SENSITIVITIES = {
  low:    { label: 'Low',    impact: 3.5, stillnessWindow: 2000, stillnessMax: 0.25, description: 'Fewer alerts, only major falls' },
  medium: { label: 'Medium', impact: 2.5, stillnessWindow: 1800, stillnessMax: 0.30, description: 'Balanced detection' },
  high:   { label: 'High',   impact: 2.0, stillnessWindow: 1500, stillnessMax: 0.38, description: 'Very sensitive, may have false alarms' },
};
export type Sensitivity = keyof typeof SENSITIVITIES;
export type FallSource = 'watch' | 'skeleton' | 'both';

export type AccelData = { x: number; y: number; z: number; magnitude: number };

export type FallEvent = {
  id: string;
  status: 'detected' | 'confirmed' | 'false_alarm' | 'cancelled';
  magnitude: number;
  detectedAt: string;
};

function normalize(v: number): number {
  return Platform.OS === 'android' ? v / G : v;
}

function calcMagnitude(x: number, y: number, z: number): number {
  return Math.sqrt(normalize(x) ** 2 + normalize(y) ** 2 + normalize(z) ** 2);
}

type FallDetectionContextValue = {
  isActive: boolean;
  mode: 'monitor' | 'alert' | 'result';
  accel: AccelData;
  countdown: number;
  fallSource: FallSource;
  fallConfidence: number;
  fallFeature: string;
  emergencyTriggered: boolean;
  setEmergencyTriggered: (v: boolean) => void;
  sensitivity: Sensitivity;
  setSensitivity: (s: Sensitivity) => void;
  events: FallEvent[];
  isLoadingHistory: boolean;
  pendingEventId: string | null;
  loadHistory: () => void;
  confirmFall: () => void;
  cancelAlert: () => void;
  markFalseAlarm: () => void;
  resetToMonitor: () => void;
  triggerFallAlert: (data: AccelData, confidence?: number, feature?: string, source?: FallSource) => void;
  handlePoseMessage: (event: { nativeEvent: { data: string } }) => void;
  registerWebviewRef: (ref: any) => void;
  startMonitoring: () => void;
  stopMonitoring: () => void;
};

const FallDetectionContext = createContext<FallDetectionContextValue | null>(null);

export function FallDetectionProvider({ children }: { children: ReactNode }) {
  const { authHeader } = useAuth();
  const base = getApiUrl();
  const ble = useBLE();

  const [isActive, setIsActive] = useState(false);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [accel, setAccel] = useState<AccelData>({ x: 0, y: 0, z: 0, magnitude: 1 });
  const [events, setEvents] = useState<FallEvent[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [mode, setMode] = useState<'monitor' | 'alert' | 'result'>('monitor');
  const [countdown, setCountdown] = useState(10);
  const [pendingFall, setPendingFall] = useState<AccelData | null>(null);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [fallSource, setFallSource] = useState<FallSource>('watch');
  const [fallConfidence, setFallConfidence] = useState(0.75);
  const [fallFeature, setFallFeature] = useState('');
  const [emergencyTriggered, setEmergencyTriggered] = useState(false);

  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const phoneAccelSubRef = useRef<{ remove: () => void } | null>(null);
  const fallWindowRef = useRef<{ type: 'impact' | null; time: number; data: AccelData; postReadings: number[] }>({
    type: null, time: 0, data: { x: 0, y: 0, z: 0, magnitude: 1 }, postReadings: [],
  });
  const modeRef = useRef(mode);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActiveRef = useRef(isActive);
  const sensitivityRef = useRef(sensitivity);
  const watchFallRef = useRef({ triggered: false, time: 0, magnitude: 0 });
  const poseFallRef = useRef({ triggered: false, time: 0, confidence: 0, feature: '' });
  const correlationFiredRef = useRef(false);
  const webviewRef = useRef<any>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);

  // Keep Render server awake while fall detection is active (free tier sleeps after 15 min)
  useEffect(() => {
    if (!isActive) return;
    const ping = () => fetch(`${base}api/health`).catch(() => {});
    ping();
    const id = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // Route BLE accelerometer data through fall detection when watch is connected
  useEffect(() => {
    if (!ble.isConnected || !ble.accel || !isActiveRef.current) return;
    const data = ble.accel;
    const accelData: AccelData = { x: data.x, y: data.y, z: data.z, magnitude: data.magnitude };
    if (modeRef.current !== 'monitor') return;
    processFallAlgorithm(accelData, Date.now());
  }, [ble.accel, ble.isConnected]);

  // React to hardware-confirmed fall from the ESP32 fall characteristic
  // The ESP32 only sends "1" after its own 10-second stillness check, so we
  // treat this as a high-confidence event and trigger the alert immediately.
  useEffect(() => {
    if (!ble.fallDetected || modeRef.current !== 'monitor') return;
    triggerFallAlert(
      { x: 0, y: 0, z: 0, magnitude: 3.5 },
      0.92,
      'esp32_hardware_confirmed',
      'watch',
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ble.fallDetected]);

  // Always run phone accelerometer for live display (separate from fall detection source)
  useEffect(() => {
    if (Platform.OS === 'web' || !Accelerometer) return;
    if (!isActive) {
      if (phoneAccelSubRef.current) { phoneAccelSubRef.current.remove(); phoneAccelSubRef.current = null; }
      return;
    }
    Accelerometer.setUpdateInterval(100);
    phoneAccelSubRef.current = Accelerometer.addListener((data: { x: number; y: number; z: number }) => {
      const mag = calcMagnitude(data.x, data.y, data.z);
      const accelData: AccelData = { x: data.x, y: data.y, z: data.z, magnitude: mag };
      // Always update display
      setAccel(accelData);
      // Use phone accel for fall detection only when watch is not connected
      if (!ble.isConnected && modeRef.current === 'monitor') {
        processFallAlgorithm(accelData, Date.now());
      }
    });
    return () => {
      if (phoneAccelSubRef.current) { phoneAccelSubRef.current.remove(); phoneAccelSubRef.current = null; }
    };
  }, [isActive, ble.isConnected]);

  // Auto-start when provider mounts (after login)
  useEffect(() => {
    const timer = setTimeout(() => {
      startMonitoring();
      loadHistory();
    }, 1000);
    return () => {
      clearTimeout(timer);
      stopMonitoring();
    };
  }, []);

  function startMonitoring() {
    setIsActive(true);
    isActiveRef.current = true;
  }

  function stopMonitoring() {
    if (phoneAccelSubRef.current) { phoneAccelSubRef.current.remove(); phoneAccelSubRef.current = null; }
    if (accelSubRef.current) { accelSubRef.current.remove(); accelSubRef.current = null; }
    setIsActive(false);
    isActiveRef.current = false;
    watchFallRef.current = { triggered: false, time: 0, magnitude: 0 };
    poseFallRef.current = { triggered: false, time: 0, confidence: 0, feature: '' };
    correlationFiredRef.current = false;
  }

  async function loadHistory() {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`${base}api/patient/fall-events`, { headers: authHeader() });
      const data = await res.json();
      if (data.events) setEvents(data.events);
    } catch {}
    setIsLoadingHistory(false);
  }

  function processFallAlgorithm(accelData: AccelData, now: number) {
    const thresh = SENSITIVITIES[sensitivityRef.current];
    const win = fallWindowRef.current;

    if (accelData.magnitude > thresh.impact && win.type !== 'impact') {
      fallWindowRef.current = { type: 'impact', time: now, data: accelData, postReadings: [] };
      return;
    }

    if (win.type === 'impact') {
      const elapsed = now - win.time;
      if (elapsed < thresh.stillnessWindow) {
        fallWindowRef.current.postReadings.push(accelData.magnitude);
        return;
      }
      const readings = win.postReadings;
      fallWindowRef.current = { type: null, time: 0, data: accelData, postReadings: [] };
      if (readings.length < 5) return;

      const mean = readings.reduce((s, v) => s + v, 0) / readings.length;
      const variance = readings.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / readings.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev < thresh.stillnessMax && modeRef.current === 'monitor') {
        watchFallRef.current = { triggered: true, time: Date.now(), magnitude: win.data.magnitude };
        checkCorrelation('watch', win.data);
      }
    }
  }

  function checkCorrelation(source: 'watch' | 'pose', data: AccelData) {
    const now = Date.now();
    const watch = watchFallRef.current;
    const pose = poseFallRef.current;
    const watchRecent = watch.triggered && (now - watch.time) < CORRELATION_WINDOW_MS;
    const poseRecent = pose.triggered && (now - pose.time) < CORRELATION_WINDOW_MS;

    if (watchRecent && poseRecent && !correlationFiredRef.current) {
      correlationFiredRef.current = true;
      triggerFallAlert({ x: 0, y: 0, z: 0, magnitude: watch.magnitude }, pose.confidence, pose.feature, 'both');
      watchFallRef.current = { triggered: false, time: 0, magnitude: 0 };
      poseFallRef.current = { triggered: false, time: 0, confidence: 0, feature: '' };
      setTimeout(() => { correlationFiredRef.current = false; }, 5000);
    } else {
      setTimeout(() => {
        if (modeRef.current !== 'monitor' || correlationFiredRef.current) return;
        const wStill = watchFallRef.current.triggered && (Date.now() - watchFallRef.current.time) < CORRELATION_WINDOW_MS * 2;
        const pStill = poseFallRef.current.triggered && (Date.now() - poseFallRef.current.time) < CORRELATION_WINDOW_MS * 2;
        if (source === 'watch' && wStill && !pStill) {
          triggerFallAlert({ x: 0, y: 0, z: 0, magnitude: watchFallRef.current.magnitude }, 0.65, 'watch_impact_unconfirmed', 'watch');
          watchFallRef.current = { triggered: false, time: 0, magnitude: 0 };
        }
        if (source === 'pose' && pStill && !wStill) {
          triggerFallAlert({ x: 0, y: 0, z: 0, magnitude: 0 }, poseFallRef.current.confidence, poseFallRef.current.feature + '_unconfirmed', 'skeleton');
          poseFallRef.current = { triggered: false, time: 0, confidence: 0, feature: '' };
        }
      }, CORRELATION_WINDOW_MS);
    }
  }

  async function triggerFallAlert(
    data: AccelData,
    confidence = 0.75,
    feature = 'watch_impact',
    source: FallSource = 'watch',
  ) {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setPendingFall(data);
    setFallSource(source);
    setFallConfidence(confidence);
    setFallFeature(feature);
    setCountdown(10);
    setMode('alert');
    modeRef.current = 'alert';

    (async () => {
      try {
        let lat: number | undefined, lng: number | undefined;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
        const res = await fetch(`${base}api/patient/fall-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({
            accelerationX: data.x, accelerationY: data.y, accelerationZ: data.z,
            magnitude: data.magnitude, locationLat: lat, locationLng: lng,
          }),
        });
        const json = await res.json();
        if (json.eventId) setPendingEventId(json.eventId);
      } catch {}
    })();

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          if (modeRef.current === 'alert') confirmFall();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function buildInjectMessage(type: string): string {
    return `window.postMessage(JSON.stringify({type:"${type}"}),"*");true;`;
  }

  async function confirmFall() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setMode('result');
    modeRef.current = 'result';
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    webviewRef.current?.injectJavaScript(buildInjectMessage('APP_CONFIRMED'));
    if (pendingEventId) {
      fetch(`${base}api/patient/fall-events/${pendingEventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ status: 'confirmed' }),
      }).catch(() => {});
    }
    loadHistory();
  }

  function cancelAlert() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    webviewRef.current?.injectJavaScript(buildInjectMessage('APP_FALSE_ALARM'));
    if (pendingEventId) {
      fetch(`${base}api/patient/fall-events/${pendingEventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ status: 'cancelled' }),
      }).catch(() => {});
    }
    setPendingFall(null);
    setPendingEventId(null);
    setMode('monitor');
    modeRef.current = 'monitor';
    loadHistory();
  }

  function markFalseAlarm() {
    webviewRef.current?.injectJavaScript(buildInjectMessage('APP_FALSE_ALARM'));
    if (pendingEventId) {
      fetch(`${base}api/patient/fall-events/${pendingEventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ status: 'false_alarm' }),
      }).catch(() => {});
    }
    resetToMonitor();
  }

  function resetToMonitor() {
    setPendingFall(null);
    setPendingEventId(null);
    setEmergencyTriggered(false);
    setMode('monitor');
    modeRef.current = 'monitor';
    loadHistory();
  }

  function handlePoseMessage(event: { nativeEvent: { data: string } }) {
    if (!isActiveRef.current) return;
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      // These messages can arrive in alert mode (user responded inside WebView overlay)
      if (msg.type === 'FALL_CONFIRMED') { confirmFall(); return; }
      if (msg.type === 'FALL_CANCELLED') { cancelAlert(); return; }
      // Only process new fall detections when idle
      if (msg.type !== 'FALL_DETECTED' || modeRef.current !== 'monitor') return;
      poseFallRef.current = { triggered: true, time: Date.now(), confidence: msg.confidence, feature: msg.feature };
      checkCorrelation('pose', { x: 0, y: 0, z: 0, magnitude: 0 });
    } catch {}
  }

  function registerWebviewRef(ref: any) {
    webviewRef.current = ref;
  }

  const sourceLabel: Record<FallSource, string> = {
    both: 'Watch + Camera (correlated)',
    watch: 'Watch accelerometer',
    skeleton: 'Camera skeleton',
  };

  const sourceIcon: Record<FallSource, string> = {
    both: 'link',
    watch: 'watch-outline',
    skeleton: 'body-outline',
  };

  return (
    <FallDetectionContext.Provider value={{
      isActive, mode, accel, countdown, fallSource, fallConfidence, fallFeature,
      emergencyTriggered, setEmergencyTriggered, sensitivity, setSensitivity,
      events, isLoadingHistory, pendingEventId, loadHistory,
      confirmFall, cancelAlert, markFalseAlarm, resetToMonitor,
      triggerFallAlert, handlePoseMessage, registerWebviewRef,
      startMonitoring, stopMonitoring,
    }}>
      {children}

      {/* ── Global Fall Alert Modal (shows on any patient screen) ── */}
      <Modal visible={mode === 'alert'} animationType="fade" transparent={false}>
        <View style={s.alertScreen}>
          <View style={s.alertIconWrap}>
            <Ionicons name="warning" size={72} color="#fff" />
          </View>
          <Text style={s.alertTitle}>Fall Detected!</Text>
          <Text style={s.alertSub}>Detected via: {sourceLabel[fallSource]}</Text>
          <View style={s.countdownCircle}>
            <Text style={s.countdownNum}>{countdown}</Text>
            <Text style={s.countdownLabel}>seconds</Text>
          </View>
          <Text style={s.alertInfo}>
            Your care giver will be notified automatically.{'\n'}Press below if this was a mistake.
          </Text>
          <Pressable style={s.cancelFallBtn} onPress={cancelAlert}>
            <Ionicons name="close-circle" size={20} color={Colors.danger} />
            <Text style={s.cancelFallText}>I'm OK — Cancel</Text>
          </Pressable>
          <Pressable style={s.verifyNowBtn} onPress={confirmFall}>
            <Ionicons name="alert-circle-outline" size={18} color="#fff" />
            <Text style={s.verifyNowText}>Confirm & Alert Now</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Global Fall Result Modal ── */}
      <Modal visible={mode === 'result'} animationType="slide" transparent>
        <View style={s.resultOverlay}>
          <View style={s.resultSheet}>
            <View style={s.resultIconWrap}>
              <Ionicons name={sourceIcon[fallSource] as any} size={48} color={Colors.danger} />
            </View>
            <Text style={s.resultTitle}>Fall Confirmed</Text>
            <View style={s.confidenceBadge}>
              <Text style={s.confidenceText}>
                {Math.round(fallConfidence * 100)}% confidence · {sourceLabel[fallSource]}
              </Text>
            </View>
            <Text style={s.resultReason}>
              {fallSource === 'both'
                ? 'Both the watch and camera independently detected this fall and agreed.'
                : fallSource === 'watch'
                ? 'The watch accelerometer detected an impact followed by stillness.'
                : 'The camera skeleton engine detected a fall posture.'}
            </Text>
            {!emergencyTriggered ? (
              <Pressable
                style={s.emergencyBtn}
                onPress={() => { setEmergencyTriggered(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }}
              >
                <Ionicons name="alert-circle" size={18} color="#fff" />
                <Text style={s.emergencyBtnText}>Emergency Triggered — Care Giver Notified</Text>
              </Pressable>
            ) : (
              <View style={s.confirmedBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                <Text style={s.confirmedText}>Care giver has been notified with your location.</Text>
              </View>
            )}
            <Pressable style={s.falseAlarmBtn} onPress={markFalseAlarm}>
              <Text style={s.falseAlarmText}>I'm OK — This Was a False Alarm</Text>
            </Pressable>
            <Pressable style={s.doneBtn} onPress={resetToMonitor}>
              <Text style={s.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </FallDetectionContext.Provider>
  );
}

export function useFallDetection(): FallDetectionContextValue {
  const ctx = useContext(FallDetectionContext);
  if (!ctx) throw new Error('useFallDetection() must be inside <FallDetectionProvider>');
  return ctx;
}

const s = StyleSheet.create({
  alertScreen: { flex: 1, backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center', padding: 32 },
  alertIconWrap: { marginBottom: 16 },
  alertTitle: { fontSize: 32, fontWeight: '700', color: '#fff', marginBottom: 8 },
  alertSub: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginBottom: 32, textAlign: 'center' },
  countdownCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  countdownNum: { fontSize: 48, fontWeight: '700', color: '#fff', lineHeight: 52 },
  countdownLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  alertInfo: { fontSize: 14, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  cancelFallBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, marginBottom: 12, width: '100%', justifyContent: 'center' },
  cancelFallText: { fontSize: 17, fontWeight: '700', color: Colors.danger },
  verifyNowBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', width: '100%', justifyContent: 'center' },
  verifyNowText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  resultOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  resultSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 44, alignItems: 'center', gap: 12 },
  resultIconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.danger + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  resultTitle: { fontSize: 24, fontWeight: '700', color: '#fff' },
  confidenceBadge: { backgroundColor: Colors.primary + '20', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 14 },
  confidenceText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  resultReason: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 20 },
  emergencyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.danger, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, width: '100%', justifyContent: 'center' },
  emergencyBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  confirmedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#10B981' + '15', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#10B981' + '30', width: '100%' },
  confirmedText: { fontSize: 13, color: '#10B981', flex: 1 },
  falseAlarmBtn: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  falseAlarmText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  doneBtn: { paddingVertical: 8 },
  doneText: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },
});
