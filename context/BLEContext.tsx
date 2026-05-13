// ─────────────────────────────────────────────────────────────────────────────
// context/BLEContext.tsx  —  Unified Bluetooth Low Energy context
//
// One BLE device sends ALL health data: vitals (heart rate, temperature, SpO2,
// blood pressure) AND accelerometer readings for fall detection.
// This context establishes a SINGLE connection shared by every patient screen,
// so vitals and fall detection never fight over the device or waste battery
// by opening two parallel connections.
//
// Usage (inside any patient tab):
//   const { status, vitals, accel, connect, disconnect, selectDevice, discoveredDevices } = useBLE();
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode,
} from 'react';
import { Platform, PermissionsAndroid } from 'react-native';


// ── Types exported for consumer screens ──────────────────────────────────────

export type BLEVitals = {
  heartRate?: number;
  spo2?: number;
  systolicBP?: number;
  diastolicBP?: number;
  temperature?: number;
};

export type BLEAccel = {
  x: number;
  y: number;
  z: number;
  magnitude: number;
};

export type BLEStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unsupported';

export type BLEDevice = { id: string; name: string | null };

// ── BLE UUIDs ─────────────────────────────────────────────────────────────────
// Standard Bluetooth GATT profiles for health measurements
const HEART_RATE_SERVICE    = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_CHAR       = '00002a37-0000-1000-8000-00805f9b34fb';
const HEALTH_THERM_SERVICE  = '00001809-0000-1000-8000-00805f9b34fb';
const TEMP_MEASUREMENT_CHAR = '00002a1c-0000-1000-8000-00805f9b34fb';

// Nordic Semiconductor UART service — used by most custom BLE devices for raw data
const NORDIC_UART_SERVICE   = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX        = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_RX        = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

// ESP32 AAL_Wearable custom service/characteristics
const ESP32_SERVICE_UUID    = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const ESP32_VITALS_CHAR     = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const ESP32_FALL_CHAR       = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';

// ── Parsers ───────────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return new Uint8Array(0); }
}

function base64ToDataView(b64: string): DataView {
  return new DataView(base64ToBytes(b64).buffer);
}

// Parse BLE heart rate characteristic (0x2A37)
// Byte 0: flags (bit 0 = 16-bit HR if set; 8-bit if not)
// Byte 1 (or bytes 1-2): heart rate value in bpm
function parseHeartRate(b64: string): number | null {
  const bytes = base64ToBytes(b64);
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  const hr = (flags & 0x01) ? ((bytes[2] << 8) | bytes[1]) : bytes[1];
  return hr > 0 ? hr : null;
}

// Parse BLE temperature characteristic (0x2A1C) — IEEE-11073 float
function parseTemperature(b64: string): number | null {
  const bytes = base64ToBytes(b64);
  if (bytes.length < 5) return null;
  const mantissa = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16);
  const exponent = bytes[4] > 127 ? bytes[4] - 256 : bytes[4];
  const tempC = mantissa * Math.pow(10, exponent);
  return tempC > 30 && tempC < 45 ? Math.round(tempC * 10) / 10 : null;
}

// Try to parse accelerometer data from a raw DataView.
// Supports ASCII text ("x,y,z" or "ACC:x,y,z"), 16-bit int triplet, and 32-bit float triplet.
function parseAccel(view: DataView): BLEAccel | null {
  try {
    const text = new TextDecoder().decode(view.buffer);
    const clean = text.replace(/ACC:/i, '').trim();
    const parts = clean.split(/[,;\s]+/);
    if (parts.length >= 3) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > 0.01 && magnitude < 50) return { x, y, z, magnitude };
      }
    }
  } catch {}

  // Try 32-bit float (12 bytes: x f32, y f32, z f32)
  if (view.byteLength >= 12) {
    try {
      const x = view.getFloat32(0, true);
      const y = view.getFloat32(4, true);
      const z = view.getFloat32(8, true);
      if (isFinite(x) && isFinite(y) && isFinite(z)) {
        const rawMag = Math.sqrt(x * x + y * y + z * z);
        const scale = rawMag > 15 ? 1 / 9.81 : 1;
        const magnitude = rawMag * scale;
        if (magnitude > 0.01 && magnitude < 50) return { x: x * scale, y: y * scale, z: z * scale, magnitude };
      }
    } catch {}
  }

  // Try 16-bit signed int (6 bytes: x i16, y i16, z i16), scaled by /1000
  if (view.byteLength >= 6) {
    try {
      const x = view.getInt16(0, true) / 1000;
      const y = view.getInt16(2, true) / 1000;
      const z = view.getInt16(4, true) / 1000;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude > 0.01 && magnitude < 50) return { x, y, z, magnitude };
    } catch {}
  }

  return null;
}

// Parse ESP32 AAL_Wearable JSON vitals packet.
// ESP32 sends: {"bpm":75,"spo2":98,"accel":1.02,"gyro":0.5}
function parseEsp32Vitals(b64: string): { heartRate?: number; spo2?: number; accel?: BLEAccel } | null {
  try {
    const text = new TextDecoder().decode(base64ToBytes(b64)).trim();
    if (!text.startsWith('{')) return null;
    const obj = JSON.parse(text);
    const result: { heartRate?: number; spo2?: number; accel?: BLEAccel } = {};
    if (typeof obj.bpm === 'number' && obj.bpm > 20 && obj.bpm < 300) result.heartRate = obj.bpm;
    if (typeof obj.spo2 === 'number' && obj.spo2 > 50 && obj.spo2 <= 100) result.spo2 = obj.spo2;
    if (typeof obj.accel === 'number' && obj.accel > 0) {
      result.accel = { x: 0, y: 0, z: obj.accel, magnitude: obj.accel };
    }
    if (result.heartRate !== undefined || result.spo2 !== undefined || result.accel) return result;
  } catch {}
  return null;
}

// Parse Nordic UART vitals packet from the watch.
// Watch sends ASCII text like "B:75,S:98" (heart rate + SpO2).
// Returns an object with the parsed fields, or null if the format is not matched.
function parseNordicVitals(b64: string): { heartRate?: number; spo2?: number } | null {
  try {
    const text = new TextDecoder().decode(base64ToBytes(b64)).trim();
    // Must contain at least one of the known prefixes
    if (!text.includes('B:') && !text.includes('S:')) return null;
    let heartRate: number | undefined;
    let spo2: number | undefined;
    // Match "B:<number>" anywhere in the string
    const hrMatch = text.match(/B:(\d+)/i);
    if (hrMatch) {
      const v = parseInt(hrMatch[1], 10);
      if (v > 20 && v < 300) heartRate = v;
    }
    // Match "S:<number>" anywhere in the string
    const spo2Match = text.match(/S:(\d+)/i);
    if (spo2Match) {
      const v = parseInt(spo2Match[1], 10);
      if (v > 50 && v <= 100) spo2 = v;
    }
    if (heartRate !== undefined || spo2 !== undefined) return { heartRate, spo2 };
  } catch {}
  return null;
}

// ── Android permissions helper ─────────────────────────────────────────────────

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const api = Platform.Version as number;
    if (api >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch { return false; }
}

// ── Singleton BleManager for native ──────────────────────────────────────────
// One manager is reused for the app's entire lifetime so we never have multiple
// BLE stacks open simultaneously (which causes permission/radio conflicts).
let NativeBleManager: any = null;
let nativeManager: any = null;
try {
  if (Platform.OS !== 'web') {
    NativeBleManager = require('react-native-ble-plx').BleManager;
  }
} catch {}

function getManager() {
  if (!nativeManager && NativeBleManager) nativeManager = new NativeBleManager();
  return nativeManager;
}

// ── Context value shape ───────────────────────────────────────────────────────

type BLEContextValue = {
  status: BLEStatus;
  deviceName: string | null;
  error: string | null;
  isConnected: boolean;
  vitals: BLEVitals;
  accel: BLEAccel | null;
  fallDetected: boolean;       // True for one tick when ESP32 sends a fall event
  discoveredDevices: BLEDevice[];
  isSupported: boolean;
  connect: () => void;       // Starts scanning; on web opens the device picker
  disconnect: () => void;    // Cancels connection and resets all state
  selectDevice: (id: string) => void; // Native only: connect to a scanned device
};

const BLEContext = createContext<BLEContextValue | null>(null);


// ── Provider ──────────────────────────────────────────────────────────────────

export function BLEProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BLEStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vitals, setVitals] = useState<BLEVitals>({});
  const [accel, setAccel] = useState<BLEAccel | null>(null);
  const [fallDetected, setFallDetected] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<BLEDevice[]>([]);

  // Refs hold the live BLE objects so callbacks always see the latest values
  // without triggering re-renders on every packet.
  const connectedRef = useRef<any>(null);
  const subscriptionsRef = useRef<any[]>([]);
  const scanSubRef = useRef<any>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webDeviceRef = useRef<any>(null);

  const isSupported = Platform.OS === 'web'
    ? (typeof navigator !== 'undefined' && 'bluetooth' in navigator)
    : !!NativeBleManager;

  // Clean up all subscriptions and connection on unmount
  useEffect(() => {
    return () => {
      cleanupNative();
    };
  }, []);


  function cleanupNative() {
    try { scanSubRef.current?.remove?.(); } catch {}
    subscriptionsRef.current.forEach(s => { try { s?.remove?.(); } catch {} });
    subscriptionsRef.current = [];
    try { connectedRef.current?.cancelConnection?.(); } catch {}
    connectedRef.current = null;
    try { getManager()?.stopDeviceScan?.(); } catch {}
    if (scanTimeoutRef.current) { clearTimeout(scanTimeoutRef.current); scanTimeoutRef.current = null; }
  }

  // ── Web Bluetooth implementation ────────────────────────────────────────────

  const connectWeb = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
      setStatus('unsupported');
      setError('Web Bluetooth is not available. Use Chrome on Android or desktop.');
      return;
    }

    setStatus('scanning');
    setError(null);

    try {
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          HEART_RATE_SERVICE, HEALTH_THERM_SERVICE, NORDIC_UART_SERVICE,
          ESP32_SERVICE_UUID,
          'heart_rate',
        ],
      });

      setStatus('connecting');
      webDeviceRef.current = device;
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('idle');
        setDeviceName(null);
        setVitals({});
        setAccel(null);
      });

      const server = await device.gatt.connect();
      setDeviceName(device.name || 'BLE Device');
      setStatus('connected');

      // Heart rate
      try {
        const hrSvc = await server.getPrimaryService(HEART_RATE_SERVICE);
        const hrChar = await hrSvc.getCharacteristic(HEART_RATE_CHAR);
        hrChar.addEventListener('characteristicvaluechanged', (e: any) => {
          const v: DataView = e.target.value;
          const flags = v.getUint8(0);
          const hr = (flags & 0x01) ? v.getUint16(1, true) : v.getUint8(1);
          if (hr > 0) setVitals(prev => ({ ...prev, heartRate: hr }));
        });
        await hrChar.startNotifications();
      } catch {}

      // Temperature
      try {
        const tempSvc = await server.getPrimaryService(HEALTH_THERM_SERVICE);
        const tempChar = await tempSvc.getCharacteristic(TEMP_MEASUREMENT_CHAR);
        tempChar.addEventListener('characteristicvaluechanged', (e: any) => {
          const bytes = new Uint8Array(e.target.value.buffer);
          if (bytes.length >= 5) {
            const mantissa = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16);
            const exponent = bytes[4] > 127 ? bytes[4] - 256 : bytes[4];
            const temp = Math.round(mantissa * Math.pow(10, exponent) * 10) / 10;
            if (temp > 30) setVitals(prev => ({ ...prev, temperature: temp }));
          }
        });
        await tempChar.startNotifications();
      } catch {}

      // ESP32 AAL_Wearable custom service (vitals + fall)
      try {
        const esp32Svc = await server.getPrimaryService(ESP32_SERVICE_UUID);

        // Vitals characteristic
        try {
          const vitalsChar = await esp32Svc.getCharacteristic(ESP32_VITALS_CHAR);
          vitalsChar.addEventListener('characteristicvaluechanged', (e: any) => {
            const view: DataView = e.target.value;
            const b64 = btoa(String.fromCharCode(...new Uint8Array(view.buffer)));
            const parsed = parseEsp32Vitals(b64);
            if (!parsed) return;
            if (parsed.heartRate !== undefined || parsed.spo2 !== undefined) {
              setVitals(prev => ({
                ...prev,
                ...(parsed.heartRate !== undefined ? { heartRate: parsed.heartRate } : {}),
                ...(parsed.spo2 !== undefined ? { spo2: parsed.spo2 } : {}),
              }));
            }
            if (parsed.accel) setAccel(parsed.accel);
          });
          await vitalsChar.startNotifications();
        } catch {}

        // Fall characteristic
        try {
          const fallChar = await esp32Svc.getCharacteristic(ESP32_FALL_CHAR);
          fallChar.addEventListener('characteristicvaluechanged', (e: any) => {
            const text = new TextDecoder().decode((e.target.value as DataView).buffer).trim();
            if (text === '1') {
              setFallDetected(true);
              setTimeout(() => setFallDetected(false), 500);
            }
          });
          await fallChar.startNotifications();
        } catch {}
      } catch {}

      // Nordic UART (accelerometer data)
      try {
        const uartSvc = await server.getPrimaryService(NORDIC_UART_SERVICE);
        const txChar = await uartSvc.getCharacteristic(NORDIC_UART_TX);
        txChar.addEventListener('characteristicvaluechanged', (e: any) => {
          const d = parseAccel(e.target.value);
          if (d) setAccel(d);
        });
        await txChar.startNotifications();
        // Tell the device to start streaming
        try {
          const rxChar = await uartSvc.getCharacteristic(NORDIC_UART_RX);
          await rxChar.writeValue(new TextEncoder().encode('START\n'));
        } catch {}
      } catch {
        // If no UART service, discover all notifiable characteristics and parse as accel
        try {
          const services = await server.getPrimaryServices();
          for (const svc of services) {
            const chars = await svc.getCharacteristics();
            for (const ch of chars) {
              if (ch.properties.notify || ch.properties.indicate) {
                ch.addEventListener('characteristicvaluechanged', (e: any) => {
                  const d = parseAccel(e.target.value);
                  if (d) setAccel(d);
                });
                try { await ch.startNotifications(); } catch {}
              }
            }
          }
        } catch {}
      }
    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.name === 'AbortError') {
        setStatus('idle');
      } else {
        setError(err.message || 'Bluetooth error');
        setStatus('error');
      }
    }
  }, []);

  const disconnectWeb = useCallback(async () => {
    try {
      if (webDeviceRef.current?.gatt?.connected) webDeviceRef.current.gatt.disconnect();
    } catch {}
    webDeviceRef.current = null;
    setStatus('idle');
    setDeviceName(null);
    setVitals({});
    setAccel(null);
  }, []);

  // ── Native BLE implementation ────────────────────────────────────────────────

  // connect() on native starts scanning and populates discoveredDevices.
  // The user picks a device from the list, then selectDevice() does the actual connection.
  const connectNative = useCallback(async () => {
    if (!NativeBleManager) { setStatus('unsupported'); return; }
    setError(null);
    setDiscoveredDevices([]);

    const granted = await requestAndroidPermissions();
    if (!granted) {
      setError('Bluetooth permissions are required.');
      setStatus('error');
      return;
    }

    const manager = getManager();
    try {
      const state = await manager.state();
      if (state !== 'PoweredOn') {
        setError('Please turn on Bluetooth and try again.');
        setStatus('error');
        return;
      }
    } catch {}

    setStatus('scanning');
    const seen = new Map<string, string | null>();

    scanSubRef.current = manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (err: any, device: any) => {
        if (err) { setError(err.message || 'Scan failed'); setStatus('error'); return; }
        if (!device || seen.has(device.id)) return;
        seen.set(device.id, device.name);
        setDiscoveredDevices(prev => {
          if (prev.find(d => d.id === device.id)) return prev;
          return [...prev, { id: device.id, name: device.name || null }];
        });
      }
    );

    // Stop scanning automatically after 30 seconds
    const SCAN_TIMEOUT_MS = 30000;
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      try { manager.stopDeviceScan(); } catch {}
      try { scanSubRef.current?.remove?.(); } catch {}
      scanTimeoutRef.current = null;
      setDiscoveredDevices(prev => {
        if (prev.length === 0) {
          setError('No devices found. Make sure your device is nearby and powered on, then try again.');
          setStatus('error');
        } else {
          // Devices already listed — just stop scanning, user can still pick one
          setStatus('idle');
        }
        return prev;
      });
    }, SCAN_TIMEOUT_MS);
  }, []);

  // selectDevice() is called after the user picks a device from discoveredDevices.
  // It stops scanning, connects, discovers services, and subscribes to all data.
  // Automatically cancels and shows an error if connection takes longer than 15 seconds.
  const selectDevice = useCallback(async (deviceId: string) => {
    const manager = getManager();
    if (!manager) return;

    try { manager.stopDeviceScan(); } catch {}
    try { scanSubRef.current?.remove?.(); } catch {}
    if (scanTimeoutRef.current) { clearTimeout(scanTimeoutRef.current); scanTimeoutRef.current = null; }

    setStatus('connecting');
    setError(null);

    const CONNECTION_TIMEOUT_MS = 15000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Connection timed out. Make sure the device is nearby and powered on, then try again.'));
      }, CONNECTION_TIMEOUT_MS);
    });

    try {
      const device = await Promise.race([
        manager.connectToDevice(deviceId, { autoConnect: false }),
        timeoutPromise,
      ]);
      if (timeoutId) clearTimeout(timeoutId);

      connectedRef.current = device;
      setDeviceName(device.name || 'BLE Device');

      await Promise.race([
        device.discoverAllServicesAndCharacteristics(),
        new Promise<never>((_, reject) => setTimeout(() =>
          reject(new Error('Service discovery timed out. Try again.')), CONNECTION_TIMEOUT_MS)),
      ]);

      // Watch for disconnection and reset state
      device.onDisconnected(() => {
        connectedRef.current = null;
        setStatus('idle');
        setDeviceName(null);
        setVitals({});
        setAccel(null);
        setDiscoveredDevices([]);
      });

      // ── Heart rate characteristic ──────────────────────────────────────────
      try {
        const hrSub = device.monitorCharacteristicForService(
          HEART_RATE_SERVICE, HEART_RATE_CHAR,
          (_err: any, char: any) => {
            if (_err || !char?.value) return;
            const hr = parseHeartRate(char.value);
            if (hr !== null) setVitals(prev => ({ ...prev, heartRate: hr }));
          }
        );
        subscriptionsRef.current.push(hrSub);
      } catch {}

      // ── Temperature characteristic ─────────────────────────────────────────
      try {
        const tempSub = device.monitorCharacteristicForService(
          HEALTH_THERM_SERVICE, TEMP_MEASUREMENT_CHAR,
          (_err: any, char: any) => {
            if (_err || !char?.value) return;
            const temp = parseTemperature(char.value);
            if (temp !== null) setVitals(prev => ({ ...prev, temperature: temp }));
          }
        );
        subscriptionsRef.current.push(tempSub);
      } catch {}

      // ── ESP32 AAL_Wearable: vitals characteristic ─────────────────────────
      try {
        const esp32VitalsSub = device.monitorCharacteristicForService(
          ESP32_SERVICE_UUID, ESP32_VITALS_CHAR,
          (_err: any, char: any) => {
            if (_err || !char?.value) return;
            const parsed = parseEsp32Vitals(char.value);
            if (!parsed) return;
            if (parsed.heartRate !== undefined || parsed.spo2 !== undefined) {
              setVitals(prev => ({
                ...prev,
                ...(parsed.heartRate !== undefined ? { heartRate: parsed.heartRate } : {}),
                ...(parsed.spo2 !== undefined ? { spo2: parsed.spo2 } : {}),
              }));
            }
            if (parsed.accel) setAccel(parsed.accel);
          }
        );
        subscriptionsRef.current.push(esp32VitalsSub);
      } catch {}

      // ── ESP32 AAL_Wearable: fall characteristic ────────────────────────────
      try {
        const esp32FallSub = device.monitorCharacteristicForService(
          ESP32_SERVICE_UUID, ESP32_FALL_CHAR,
          (_err: any, char: any) => {
            if (_err || !char?.value) return;
            try {
              const text = new TextDecoder().decode(base64ToBytes(char.value)).trim();
              if (text === '1') {
                setFallDetected(true);
                // Auto-clear after one render cycle so FallDetectionContext gets a clean rising edge
                setTimeout(() => setFallDetected(false), 500);
              }
            } catch {}
          }
        );
        subscriptionsRef.current.push(esp32FallSub);
      } catch {}

      // ── Nordic UART (vitals "B:HR,S:SPO2" + optional accel data) ──────────
      let subscribedUart = false;
      try {
        const uartSub = device.monitorCharacteristicForService(
          NORDIC_UART_SERVICE, NORDIC_UART_TX,
          (_err: any, char: any) => {
            if (_err || !char?.value) return;
            // 1. Try vitals format first ("B:75,S:98" from watch)
            const vitals = parseNordicVitals(char.value);
            if (vitals) {
              setVitals(prev => ({
                ...prev,
                ...(vitals.heartRate !== undefined ? { heartRate: vitals.heartRate } : {}),
                ...(vitals.spo2 !== undefined ? { spo2: vitals.spo2 } : {}),
              }));
              return;
            }
            // 2. Otherwise try accelerometer format (x,y,z or binary)
            const d = parseAccel(base64ToDataView(char.value));
            if (d) setAccel(d);
          }
        );
        subscriptionsRef.current.push(uartSub);
        subscribedUart = true;

        // Send START command to tell device to begin streaming
        try {
          const cmd = btoa('START\n');
          await device.writeCharacteristicWithResponseForService(NORDIC_UART_SERVICE, NORDIC_UART_RX, cmd);
        } catch {}
      } catch {}

      // ── Fallback: scan ALL notifiable characteristics ──────────────────────
      // If the device uses custom UUIDs not in our known list, this picks them up.
      if (!subscribedUart) {
        try {
          const services = await device.services();
          for (const svc of services) {
            try {
              const chars = await device.characteristicsForService(svc.uuid);
              for (const ch of chars) {
                if (ch.isNotifiable || ch.isIndicatable) {
                  try {
                    const sub = device.monitorCharacteristicForService(
                      svc.uuid, ch.uuid,
                      (_err: any, c: any) => {
                        if (_err || !c?.value) return;
                        // Try ESP32 JSON format first
                        const esp = parseEsp32Vitals(c.value);
                        if (esp) {
                          if (esp.heartRate !== undefined || esp.spo2 !== undefined) {
                            setVitals(prev => ({
                              ...prev,
                              ...(esp.heartRate !== undefined ? { heartRate: esp.heartRate } : {}),
                              ...(esp.spo2 !== undefined ? { spo2: esp.spo2 } : {}),
                            }));
                          }
                          if (esp.accel) setAccel(esp.accel);
                          return;
                        }
                        const d = parseAccel(base64ToDataView(c.value));
                        if (d) setAccel(d);
                      }
                    );
                    subscriptionsRef.current.push(sub);
                  } catch {}
                }
              }
            } catch {}
          }
        } catch {}
      }

      setStatus('connected');
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      try { manager.cancelDeviceConnection(deviceId); } catch {}
      cleanupNative();
      setError(err.message || 'Failed to connect. Try again.');
      setStatus('error');
    }
  }, []);

  const disconnectNative = useCallback(async () => {
    cleanupNative();
    setStatus('idle');
    setDeviceName(null);
    setVitals({});
    setAccel(null);
    setDiscoveredDevices([]);
    setError(null);
  }, []);

  // ── Unified interface (auto-selects web vs native) ────────────────────────

  const connect = Platform.OS === 'web' ? connectWeb : connectNative;
  const disconnect = Platform.OS === 'web' ? disconnectWeb : disconnectNative;

  const value: BLEContextValue = {
    status,
    deviceName,
    error,
    isConnected: status === 'connected',
    vitals,
    accel,
    fallDetected,
    discoveredDevices,
    isSupported,
    connect,
    disconnect,
    selectDevice,
  };

  return <BLEContext.Provider value={value}>{children}</BLEContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBLE(): BLEContextValue {
  const ctx = useContext(BLEContext);
  if (!ctx) throw new Error('useBLE() must be called inside a <BLEProvider>');
  return ctx;
}
