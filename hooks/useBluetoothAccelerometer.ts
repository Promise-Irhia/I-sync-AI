import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';

export type BLEAccelData = { x: number; y: number; z: number; magnitude: number };
export type BLEAccelStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error' | 'unsupported';
export type BLEDevice = { id: string; name: string | null };

// Nordic Semiconductor UART Service — most common open BLE data protocol
const NORDIC_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const ENV_SENSING_SERVICE = '00001822-0000-1000-8000-00805f9b34fb';

// ── Data parsers (shared between web and native) ──────────────────────────────

function parseAscii(text: string): BLEAccelData | null {
  const clean = text.replace(/ACC:/i, '').trim();
  const parts = clean.split(/[,;\s]+/);
  if (parts.length < 3) return null;
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
  return { x, y, z, magnitude: Math.sqrt(x * x + y * y + z * z) };
}

function parseBinaryInt16(buf: DataView): BLEAccelData | null {
  if (buf.byteLength < 6) return null;
  const x = buf.getInt16(0, true) / 1000;
  const y = buf.getInt16(2, true) / 1000;
  const z = buf.getInt16(4, true) / 1000;
  return { x, y, z, magnitude: Math.sqrt(x * x + y * y + z * z) };
}

function parseBinaryFloat32(buf: DataView): BLEAccelData | null {
  if (buf.byteLength < 12) return null;
  const x = buf.getFloat32(0, true);
  const y = buf.getFloat32(4, true);
  const z = buf.getFloat32(8, true);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  const rawMag = Math.sqrt(x * x + y * y + z * z);
  const scale = rawMag > 15 ? 1 / 9.81 : 1;
  return { x: x * scale, y: y * scale, z: z * scale, magnitude: rawMag * scale };
}

function parseDataView(view: DataView): BLEAccelData | null {
  try {
    const text = new TextDecoder().decode(view.buffer);
    const ascii = parseAscii(text);
    if (ascii) return ascii;
  } catch {}
  const f32 = parseBinaryFloat32(view);
  if (f32 && f32.magnitude > 0.01 && f32.magnitude < 50) return f32;
  const i16 = parseBinaryInt16(view);
  if (i16 && i16.magnitude > 0.01 && i16.magnitude < 50) return i16;
  return null;
}

// Convert base64 string (from react-native-ble-plx) to DataView
function base64ToDataView(b64: string): DataView {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new DataView(bytes.buffer);
}

// ── Web Bluetooth implementation ──────────────────────────────────────────────

function useWebBLE(onData: (d: BLEAccelData) => void) {
  const [status, setStatus] = useState<BLEAccelStatus>(
    typeof navigator !== 'undefined' && 'bluetooth' in navigator ? 'idle' : 'unsupported'
  );
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<any>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const connect = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
      setStatus('unsupported'); return;
    }
    setStatus('scanning');
    setError(null);
    try {
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          NORDIC_UART_SERVICE, ENV_SENSING_SERVICE,
          'a4e649f4-4be5-11e5-885d-feff819cdc9f',
          '00030002-0300-1000-8000-00805f9b34fb',
        ],
      });
      setStatus('connecting');
      deviceRef.current = device;
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('idle'); setDeviceName(null);
      });
      const server = await device.gatt.connect();
      setDeviceName(device.name || 'BLE Device');
      setStatus('connected');

      let subscribed = false;
      try {
        const uartSvc = await server.getPrimaryService(NORDIC_UART_SERVICE);
        const txChar = await uartSvc.getCharacteristic(NORDIC_UART_TX);
        txChar.addEventListener('characteristicvaluechanged', (evt: any) => {
          const d = parseDataView(evt.target.value);
          if (d) onDataRef.current(d);
        });
        await txChar.startNotifications();
        subscribed = true;
        try {
          const rxChar = await uartSvc.getCharacteristic(NORDIC_UART_RX);
          await rxChar.writeValue(new TextEncoder().encode('START\n'));
        } catch {}
      } catch {}

      if (!subscribed) {
        try {
          const services = await server.getPrimaryServices();
          for (const svc of services) {
            try {
              const chars = await svc.getCharacteristics();
              for (const ch of chars) {
                if (ch.properties.notify || ch.properties.indicate) {
                  ch.addEventListener('characteristicvaluechanged', (evt: any) => {
                    const d = parseDataView(evt.target.value);
                    if (d) onDataRef.current(d);
                  });
                  await ch.startNotifications();
                  subscribed = true;
                }
              }
            } catch {}
          }
        } catch {}
      }
      if (!subscribed) setError('Connected but no accelerometer data found on this device.');
    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.name === 'AbortError') setStatus('idle');
      else { setError(err.message || 'BLE connection failed'); setStatus('error'); }
    }
  }, []);

  const disconnect = useCallback(async () => {
    try { if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect(); } catch {}
    deviceRef.current = null;
    setStatus('idle'); setDeviceName(null);
  }, []);

  return {
    status, deviceName, error,
    isSupported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    connect, disconnect,
    discoveredDevices: [] as BLEDevice[],
    selectDevice: (_id: string) => {},
  };
}

// ── Native BLE implementation (react-native-ble-plx) ─────────────────────────

let BleManager: any = null;
let BleState: any = null;
try {
  if (Platform.OS !== 'web') {
    const mod = require('react-native-ble-plx');
    BleManager = mod.BleManager;
    BleState = mod.State;
  }
} catch {}

// Singleton manager — one per app lifetime
let nativeManager: any = null;
function getManager() {
  if (!nativeManager && BleManager) nativeManager = new BleManager();
  return nativeManager;
}

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

function useNativeBLE(onData: (d: BLEAccelData) => void) {
  const [status, setStatus] = useState<BLEAccelStatus>(BleManager ? 'idle' : 'unsupported');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<BLEDevice[]>([]);

  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const connectedDeviceRef = useRef<any>(null);
  const subscriptionRef = useRef<any>(null);
  const scanSubRef = useRef<any>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { scanSubRef.current?.remove(); } catch {}
      try { subscriptionRef.current?.remove(); } catch {}
      try { connectedDeviceRef.current?.cancelConnection(); } catch {}
    };
  }, []);

  const connect = useCallback(async () => {
    if (!BleManager) { setStatus('unsupported'); return; }
    setError(null);
    setDiscoveredDevices([]);

    const granted = await requestAndroidPermissions();
    if (!granted) {
      setError('Bluetooth permissions are required.'); setStatus('error'); return;
    }

    const manager = getManager();

    // Wait for BLE to power on
    try {
      const state = await manager.state();
      if (state !== 'PoweredOn') {
        setError('Please turn on Bluetooth and try again.'); setStatus('error'); return;
      }
    } catch {}

    setStatus('scanning');
    const seen = new Map<string, string | null>();

    scanSubRef.current = manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (err: any, device: any) => {
        if (err) {
          setError(err.message || 'Scan failed'); setStatus('error'); return;
        }
        if (!device) return;
        if (!seen.has(device.id)) {
          seen.set(device.id, device.name);
          setDiscoveredDevices(prev => {
            if (prev.find(d => d.id === device.id)) return prev;
            return [...prev, { id: device.id, name: device.name || null }];
          });
        }
      }
    );
  }, []);

  const selectDevice = useCallback(async (deviceId: string) => {
    const manager = getManager();
    if (!manager) return;

    // Stop scanning
    try { manager.stopDeviceScan(); } catch {}
    try { scanSubRef.current?.remove(); } catch {}

    setStatus('connecting');
    setError(null);

    try {
      const device = await manager.connectToDevice(deviceId, { autoConnect: false });
      connectedDeviceRef.current = device;
      setDeviceName(device.name || 'BLE Device');

      await device.discoverAllServicesAndCharacteristics();

      // Listen for disconnection
      device.onDisconnected((_err: any, _dev: any) => {
        connectedDeviceRef.current = null;
        setStatus('idle');
        setDeviceName(null);
        setDiscoveredDevices([]);
      });

      let subscribed = false;

      // Try Nordic UART TX first
      try {
        const sub = device.monitorCharacteristicForService(
          NORDIC_UART_SERVICE, NORDIC_UART_TX,
          (err: any, char: any) => {
            if (err || !char?.value) return;
            const d = parseDataView(base64ToDataView(char.value));
            if (d) onDataRef.current(d);
          }
        );
        subscriptionRef.current = sub;
        subscribed = true;

        // Send START command
        try {
          const cmd = btoa('START\n');
          await device.writeCharacteristicWithResponseForService(NORDIC_UART_SERVICE, NORDIC_UART_RX, cmd);
        } catch {}
      } catch {}

      // Fall back: scan all characteristics for notifiable ones
      if (!subscribed) {
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
                      (err: any, c: any) => {
                        if (err || !c?.value) return;
                        const d = parseDataView(base64ToDataView(c.value));
                        if (d) onDataRef.current(d);
                      }
                    );
                    if (!subscriptionRef.current) subscriptionRef.current = sub;
                    subscribed = true;
                  } catch {}
                }
              }
            } catch {}
          }
        } catch {}
      }

      if (!subscribed) {
        setError('Connected but no accelerometer data found on this device.');
      }
      setStatus('connected');
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
      setStatus('error');
    }
  }, []);

  const disconnect = useCallback(async () => {
    try { getManager()?.stopDeviceScan(); } catch {}
    try { scanSubRef.current?.remove(); } catch {}
    try { subscriptionRef.current?.remove(); } catch {}
    try { connectedDeviceRef.current?.cancelConnection(); } catch {}
    connectedDeviceRef.current = null;
    subscriptionRef.current = null;
    setStatus('idle');
    setDeviceName(null);
    setDiscoveredDevices([]);
    setError(null);
  }, []);

  return {
    status, deviceName, error,
    isSupported: !!BleManager,
    connect, disconnect,
    discoveredDevices,
    selectDevice,
  };
}

// ── Public hook — auto-selects web vs native ──────────────────────────────────

export function useBluetoothAccelerometer(onData: (d: BLEAccelData) => void) {
  const web    = useWebBLE(Platform.OS === 'web' ? onData : () => {});
  const native = useNativeBLE(Platform.OS !== 'web' ? onData : () => {});
  return Platform.OS === 'web' ? web : native;
}
