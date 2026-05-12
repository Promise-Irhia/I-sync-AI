import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, useColorScheme,
  Platform, Modal, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/colors';
import { useBLE } from '@/context/BLEContext';
import { WebView } from 'react-native-webview';
import {
  useFallDetection, SENSITIVITIES, type Sensitivity, type FallEvent,
} from '@/context/FallDetectionContext';
import { getApiUrl } from '@/lib/query-client';

const G = 9.81;

function normalize(v: number): number {
  return Platform.OS === 'android' ? v / G : v;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ', ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

const POSE_ENGINE_URL = `${getApiUrl()}pose-engine`;

const injectedAutoStart = `
  (function() {
    window.__isInsideISync = true;
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'POSE_ENGINE_READY', confidence: 0, feature: '' })
    );
  })();
  true;
`;

export default function FallDetectionScreen() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const ble = useBLE();

  const fd = useFallDetection();

  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [activityLevel, setActivityLevel] = useState<'low' | 'moderate' | 'high'>('moderate');
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [poseEngineStatus, setPoseEngineStatus] = useState<'loading' | 'ready' | 'error' | 'off'>('off');

  const webviewRef = useRef<any>(null);

  // Register WebView ref with context so it can inject JS for confirm/cancel
  useEffect(() => {
    fd.registerWebviewRef(webviewRef.current);
  });

  // Start/restart PoseEngine WebView when monitoring is active
  useEffect(() => {
    if (fd.isActive && POSE_ENGINE_URL && Platform.OS !== 'web') {
      setPoseEngineStatus('loading');
    } else {
      setPoseEngineStatus('off');
    }
  }, [fd.isActive]);

  useFocusEffect(useCallback(() => {
    fd.loadHistory();
  }, []));

  function applyPersonalization() {
    const a = parseInt(age, 10);
    const w = parseInt(weight, 10);
    let recommended: Sensitivity = 'medium';
    if (!isNaN(a)) {
      if (a >= 65) recommended = 'high';
      else if (a <= 30 && activityLevel === 'high') recommended = 'low';
    }
    if (!isNaN(w) && w > 100 && recommended !== 'high') recommended = 'high';
    if (activityLevel === 'high' && recommended === 'medium') recommended = 'low';
    fd.setSensitivity(recommended);
    setShowPersonalize(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const WEB = Platform.OS === 'web';
  const webC: any = WEB ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {};
  const statusColor = fd.isActive ? '#10B981' : C.textMuted;

  const { accel } = fd;
  const accelBars = [
    { label: 'X', value: accel.x, color: Colors.primary },
    { label: 'Y', value: accel.y, color: Colors.purple },
    { label: 'Z', value: accel.z, color: '#F59E0B' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      {/* ── Header ── */}
      <View style={[styles.headerOuter, { paddingTop: topPad + 12, borderBottomColor: C.divider }]}>
        <View style={[styles.headerInner, webC]}>
          <View style={styles.headerLeft}>
            <View style={[styles.headerIconWrap, { backgroundColor: Colors.danger + '18' }]}>
              <Ionicons name="shield-checkmark" size={22} color={Colors.danger} />
            </View>
            <View>
              <Text style={[styles.headerTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Fall Detection</Text>
              <Text style={[styles.headerSub, { color: statusColor, fontFamily: 'Inter_400Regular' }]}>
                {fd.isActive ? '● Monitoring active' : '○ Inactive'}
              </Text>
            </View>
          </View>
          <Pressable
            style={[styles.toggleBtn, { backgroundColor: fd.isActive ? Colors.danger + '18' : Colors.secondary + '18', borderColor: fd.isActive ? Colors.danger + '40' : Colors.secondary + '40' }]}
            onPress={() => { fd.isActive ? fd.stopMonitoring() : fd.startMonitoring(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <Ionicons name={fd.isActive ? 'pause-circle' : 'play-circle'} size={20} color={fd.isActive ? Colors.danger : Colors.secondary} />
            <Text style={[styles.toggleText, { color: fd.isActive ? Colors.danger : Colors.secondary, fontFamily: 'Inter_600SemiBold' }]}>
              {fd.isActive ? 'Stop' : 'Start'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, { backgroundColor: Colors.warning + '18', borderColor: Colors.warning + '40' }]}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              fd.triggerFallAlert({ x: 0.1, y: 0.05, z: 0.08, magnitude: 3.2 }, 0.85, 'test', 'both');
            }}
          >
            <Ionicons name="flash-outline" size={20} color={Colors.warning} />
            <Text style={[styles.toggleText, { color: Colors.warning, fontFamily: 'Inter_600SemiBold' }]}>Test</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[{ paddingBottom: 100, paddingHorizontal: 16, paddingTop: 16, gap: 14 }, WEB && { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[{ width: '100%', gap: 14 }, webC]}>

          {WEB && (
            <View style={[styles.infoCard, { backgroundColor: Colors.warning + '15', borderColor: Colors.warning + '30' }]}>
              <Ionicons name="phone-portrait-outline" size={16} color={Colors.warning} />
              <Text style={[styles.infoText, { color: Colors.warning, fontFamily: 'Inter_400Regular' }]}>
                Accelerometer monitoring requires the mobile app. Use the Expo Go app on your phone.
              </Text>
            </View>
          )}

          {/* PoseEngine WebView */}
          {!WEB && fd.isActive && POSE_ENGINE_URL && (
            <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={styles.cardHeader}>
                <Ionicons name="body-outline" size={16} color={Colors.secondary} />
                <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Camera Detection</Text>
                <View style={[styles.magBadge, {
                  backgroundColor: poseEngineStatus === 'ready' ? '#10B981' + '20'
                    : poseEngineStatus === 'error' ? Colors.danger + '20'
                    : Colors.warning + '20',
                }]}>
                  <Text style={[styles.magText, {
                    color: poseEngineStatus === 'ready' ? '#10B981'
                      : poseEngineStatus === 'error' ? Colors.danger
                      : Colors.warning,
                    fontFamily: 'Inter_700Bold',
                  }]}>
                    {poseEngineStatus === 'ready' ? 'Active' : poseEngineStatus === 'error' ? 'Error' : 'Loading...'}
                  </Text>
                </View>
              </View>
              <WebView
                ref={webviewRef}
                source={{ uri: POSE_ENGINE_URL }}
                style={styles.webview}
                onMessage={fd.handlePoseMessage}
                injectedJavaScript={injectedAutoStart}
                mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback
                javaScriptEnabled
                domStorageEnabled
                allowsProtectedMedia
                mediaCapturePermissionGrantType="grant"
                onPermissionRequest={(req: any) => req.grant(req.resources)}
                onError={() => setPoseEngineStatus('error')}
                onLoad={() => setPoseEngineStatus('loading')}
                onLoadEnd={() => fd.registerWebviewRef(webviewRef.current)}
              />
              {poseEngineStatus === 'error' && (
                <View style={[styles.infoCard, { backgroundColor: Colors.warning + '15', borderColor: Colors.warning + '30', marginTop: 4 }]}>
                  <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                  <Text style={[styles.infoText, { color: Colors.warning, fontFamily: 'Inter_400Regular', fontSize: 12 }]}>
                    Camera detection unavailable. Accelerometer is still active.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Live Sensor Card ── */}
          {!WEB && (
            <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
              <View style={styles.cardHeader}>
                <Ionicons name="speedometer-outline" size={16} color={Colors.primary} />
                <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Live Motion</Text>
                <View style={[styles.magBadge, { backgroundColor: accel.magnitude > 2 ? Colors.danger + '20' : Colors.primary + '15' }]}>
                  <Text style={[styles.magText, { color: accel.magnitude > 2 ? Colors.danger : Colors.primary, fontFamily: 'Inter_700Bold' }]}>
                    {accel.magnitude.toFixed(2)}g
                  </Text>
                </View>
              </View>

              {/* Axis bars + numeric values */}
              <View style={styles.accelBars}>
                {accelBars.map(bar => {
                  const norm = Math.min(1, Math.abs(normalize(bar.value)));
                  const val = normalize(bar.value);
                  return (
                    <View key={bar.label} style={styles.accelRow}>
                      <Text style={[styles.accelLabel, { color: C.textMuted, fontFamily: 'Inter_500Medium' }]}>{bar.label}</Text>
                      <View style={[styles.accelTrack, { backgroundColor: C.input }]}>
                        <View style={[styles.accelFill, { width: `${norm * 100}%`, backgroundColor: bar.color }]} />
                      </View>
                      <Text style={[styles.accelVal, { color: bar.color, fontFamily: 'Inter_700Bold' }]}>
                        {val >= 0 ? '+' : ''}{val.toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Numeric readout grid */}
              <View style={styles.accelGrid}>
                {accelBars.map(bar => {
                  const val = normalize(bar.value);
                  return (
                    <View key={bar.label} style={[styles.accelGridCell, { backgroundColor: bar.color + '12', borderColor: bar.color + '30' }]}>
                      <Text style={[styles.accelGridAxis, { color: bar.color, fontFamily: 'Inter_700Bold' }]}>{bar.label}-axis</Text>
                      <Text style={[styles.accelGridVal, { color: bar.color, fontFamily: 'Inter_700Bold' }]}>
                        {val >= 0 ? '+' : ''}{val.toFixed(3)} g
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Source indicator */}
              {ble.isConnected ? (
                <View style={[styles.infoCard, { backgroundColor: Colors.secondary + '10', borderColor: Colors.secondary + '25' }]}>
                  <Ionicons name="bluetooth" size={13} color={Colors.secondary} />
                  <Text style={[styles.infoText, { color: Colors.secondary, fontFamily: 'Inter_400Regular', fontSize: 12 }]}>
                    Watch connected · Phone sensor active for motion display
                  </Text>
                </View>
              ) : (
                <View style={[styles.infoCard, { backgroundColor: Colors.warning + '10', borderColor: Colors.warning + '25' }]}>
                  <Ionicons name="phone-portrait-outline" size={13} color={Colors.warning} />
                  <Text style={[styles.infoText, { color: Colors.warning, fontFamily: 'Inter_400Regular', fontSize: 12 }]}>
                    Using phone accelerometer — connect watch for better accuracy
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Sensitivity */}
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="options-outline" size={16} color={Colors.purple} />
              <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Sensitivity</Text>
            </View>
            <View style={styles.sensitivityRow}>
              {(Object.keys(SENSITIVITIES) as Sensitivity[]).map(key => {
                const s = SENSITIVITIES[key];
                const selected = fd.sensitivity === key;
                return (
                  <Pressable
                    key={key}
                    style={[styles.sensBtn, { backgroundColor: selected ? Colors.purple + '20' : C.input, borderColor: selected ? Colors.purple : C.inputBorder }]}
                    onPress={() => fd.setSensitivity(key)}
                  >
                    <Text style={[styles.sensBtnLabel, { color: selected ? Colors.purple : C.textSub, fontFamily: 'Inter_700Bold' }]}>{s.label}</Text>
                    <Text style={[styles.sensBtnSub, { color: selected ? Colors.purple + 'CC' : C.textMuted, fontFamily: 'Inter_400Regular' }]}>{s.impact}g</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.sensHint, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              {SENSITIVITIES[fd.sensitivity].description}
            </Text>
          </View>

          {/* Personal Profile */}
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={[styles.cardHeader, { justifyContent: 'space-between' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="person-circle-outline" size={16} color={Colors.secondary} />
                <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Personal Profile</Text>
              </View>
              <Pressable onPress={() => setShowPersonalize(true)}>
                <Text style={{ color: Colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
                  {age || weight ? 'Edit' : 'Set Up'}
                </Text>
              </Pressable>
            </View>
            {age || weight ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                {age ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13 }}>Age</Text>
                    <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{age} yrs</Text>
                  </View>
                ) : null}
                {weight ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13 }}>Weight</Text>
                    <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{weight} kg</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13 }}>Activity</Text>
                  <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
                    {activityLevel.charAt(0).toUpperCase() + activityLevel.slice(1)}
                  </Text>
                </View>
                <View style={[styles.infoCard, { backgroundColor: Colors.secondary + '10', borderColor: Colors.secondary + '25', marginTop: 4 }]}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={Colors.secondary} />
                  <Text style={{ color: Colors.secondary, fontFamily: 'Inter_400Regular', fontSize: 12 }}>
                    Sensitivity auto-adjusted to {fd.sensitivity} based on your profile
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={[styles.sensHint, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
                Add your age, weight, and activity level to auto-calibrate fall detection sensitivity.
              </Text>
            )}
          </View>

          {/* How It Works */}
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>How It Works</Text>
            </View>
            <View style={styles.steps}>
              {[
                { icon: 'checkmark-circle', color: '#10B981', text: 'Monitoring starts automatically when you log in' },
                { icon: 'watch-outline',     color: Colors.primary,   text: 'Watch streams vitals (HR, SpO2) via Nordic UART Bluetooth' },
                { icon: 'body-outline',      color: Colors.secondary, text: 'Camera skeleton engine watches posture continuously' },
                { icon: 'flash',             color: Colors.warning,   text: 'Impact spike + post-fall stillness triggers accelerometer signal' },
                { icon: 'git-merge-outline', color: Colors.purple,    text: 'Both sources must agree within 3 seconds (dual mode)' },
                { icon: 'timer-outline',     color: '#10B981',        text: "10-second countdown — press I'm OK to cancel false alarms" },
                { icon: 'alert-circle',      color: Colors.danger,    text: 'Confirmed falls notify your care giver immediately' },
              ].map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={[styles.stepIcon, { backgroundColor: step.color + '18' }]}>
                    <Ionicons name={step.icon as any} size={14} color={step.color} />
                  </View>
                  <Text style={[styles.stepText, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>{step.text}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Recent Events */}
          <View style={styles.historySection}>
            <View style={styles.cardHeader}>
              <Ionicons name="time-outline" size={16} color={C.textMuted} />
              <Text style={[styles.cardTitle, { color: C.text, fontFamily: 'Inter_600SemiBold' }]}>Recent Events</Text>
              <Pressable onPress={fd.loadHistory} style={styles.refreshBtn}>
                <Ionicons name="refresh-outline" size={16} color={Colors.primary} />
              </Pressable>
            </View>
            {fd.isLoadingHistory ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />
            ) : fd.events.length === 0 ? (
              <View style={[styles.emptyHistory, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
                <Ionicons name="shield-checkmark-outline" size={32} color={C.textMuted} />
                <Text style={[styles.emptyHistoryText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>No fall events recorded</Text>
              </View>
            ) : (
              fd.events.map(ev => <EventRow key={ev.id} event={ev} C={C} />)
            )}
          </View>

        </View>
      </ScrollView>

      {/* Personalize Modal */}
      <Modal visible={showPersonalize} animationType="slide" transparent presentationStyle="formSheet">
        <View style={[styles.modalWrap, { backgroundColor: C.bg, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.modalHandle, { backgroundColor: C.cardBorder }]} />
          <Text style={[styles.modalTitle, { color: C.text, fontFamily: 'Inter_700Bold', marginBottom: 4 }]}>Personal Profile</Text>
          <Text style={[styles.modalSub, { color: C.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 20 }]}>
            Help the system calibrate fall sensitivity for your body type and lifestyle.
          </Text>
          <Text style={[styles.sensHint, { color: C.textSub, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }]}>Age (years)</Text>
          <TextInput
            style={[styles.personalInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
            placeholder="e.g. 45" placeholderTextColor={C.textMuted}
            value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3}
          />
          <Text style={[styles.sensHint, { color: C.textSub, fontFamily: 'Inter_600SemiBold', marginBottom: 6, marginTop: 12 }]}>Weight (kg)</Text>
          <TextInput
            style={[styles.personalInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
            placeholder="e.g. 70" placeholderTextColor={C.textMuted}
            value={weight} onChangeText={setWeight} keyboardType="number-pad" maxLength={3}
          />
          <Text style={[styles.sensHint, { color: C.textSub, fontFamily: 'Inter_600SemiBold', marginBottom: 10, marginTop: 12 }]}>Activity Level</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
            {(['low', 'moderate', 'high'] as const).map(lvl => (
              <Pressable
                key={lvl}
                style={[styles.sensBtn, { flex: 1, backgroundColor: activityLevel === lvl ? Colors.secondary + '20' : C.input, borderColor: activityLevel === lvl ? Colors.secondary : C.inputBorder }]}
                onPress={() => setActivityLevel(lvl)}
              >
                <Text style={[styles.sensBtnLabel, { color: activityLevel === lvl ? Colors.secondary : C.textSub, fontFamily: 'Inter_700Bold', textTransform: 'capitalize' }]}>{lvl}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={[styles.modalBtn, { flex: 1, backgroundColor: C.input, borderColor: C.inputBorder }]} onPress={() => setShowPersonalize(false)}>
              <Text style={[styles.modalBtnText, { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalBtn, { flex: 2, backgroundColor: Colors.primary }]} onPress={applyPersonalization}>
              <Text style={[styles.modalBtnText, { color: '#fff', fontFamily: 'Inter_600SemiBold' }]}>Apply & Auto-Calibrate</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EventRow({ event, C }: { event: FallEvent; C: any }) {
  const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
    detected:    { color: Colors.warning, icon: 'alert-circle-outline', label: 'Detected' },
    confirmed:   { color: Colors.danger,  icon: 'alert-circle',         label: 'Confirmed' },
    false_alarm: { color: '#10B981',      icon: 'checkmark-circle',     label: 'False Alarm' },
    cancelled:   { color: Colors.purple,  icon: 'close-circle-outline', label: 'Cancelled' },
  };
  const cfg = statusConfig[event.status] || statusConfig.detected;
  return (
    <View style={[styles.eventRow, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
      <View style={[styles.eventIcon, { backgroundColor: cfg.color + '18' }]}>
        <Ionicons name={cfg.icon as any} size={18} color={cfg.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.eventTop}>
          <Text style={[styles.eventStatus, { color: cfg.color, fontFamily: 'Inter_600SemiBold' }]}>{cfg.label}</Text>
          <Text style={[styles.eventMag, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{event.magnitude?.toFixed(2)}g impact</Text>
        </View>
        <Text style={[styles.eventTime, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>{formatTime(event.detectedAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOuter: { borderBottomWidth: 1, paddingHorizontal: 20, paddingBottom: 14 },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, marginTop: 1 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  toggleText: { fontSize: 14 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, flex: 1 },
  magBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  magText: { fontSize: 13 },
  webview: { height: 200, borderRadius: 10, overflow: 'hidden' },
  accelBars: { gap: 8 },
  accelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accelLabel: { width: 16, fontSize: 12, textAlign: 'center' },
  accelTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  accelFill: { height: '100%', borderRadius: 3, minWidth: 4 },
  accelVal: { width: 52, fontSize: 12, textAlign: 'right' },
  accelGrid: { flexDirection: 'row', gap: 8, marginTop: 4 },
  accelGridCell: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10, alignItems: 'center', gap: 4 },
  accelGridAxis: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  accelGridVal: { fontSize: 15 },
  sensitivityRow: { flexDirection: 'row', gap: 10 },
  sensBtn: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 3 },
  sensBtnLabel: { fontSize: 14 },
  sensBtnSub: { fontSize: 11 },
  sensHint: { fontSize: 12, textAlign: 'center' },
  steps: { gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19 },
  historySection: { gap: 10 },
  refreshBtn: { padding: 4 },
  emptyHistory: { borderRadius: 14, borderWidth: 1, padding: 24, alignItems: 'center', gap: 8 },
  emptyHistoryText: { fontSize: 13 },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  eventIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  eventTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventStatus: { fontSize: 14 },
  eventMag: { fontSize: 12 },
  eventTime: { fontSize: 11, marginTop: 2 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19 },
  modalWrap: { flex: 1, paddingHorizontal: 20 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, marginBottom: 4 },
  modalSub: { fontSize: 14, lineHeight: 20 },
  modalBtn: { paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { fontSize: 15 },
  personalInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 4 },
});
