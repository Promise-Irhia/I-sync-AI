import { useState, useCallback, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';

export type BluetoothVitals = {
  heartRate?: number;
  spo2?: number;
  systolicBP?: number;
  diastolicBP?: number;
  temperature?: number;
};

export type BluetoothStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unsupported';

export type BluetoothDevice = {
  id: string;
  name: string;
};

const HEART_RATE_SERVICE    = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_CHAR       = '00002a37-0000-1000-8000-00805f9b34fb';
const HEALTH_THERM_SERVICE  = '00001809-0000-1000-8000-00805f9b34fb';
const TEMP_MEASUREMENT_CHAR = '00002a1c-0000-1000-8000-00805f9b34fb';

async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    if ((Platform.Version as number) >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === 'granted' &&
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === 'granted'
      );
    } else {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return result === 'granted';
    }
  } catch {
    return false;
  }
}

function base64ToBytes(b64: string): number[] {
  try {
    return atob(b64).split('').map(c => c.charCodeAt(0));
  } catch { return []; }
}

function parseHeartRate(value: any): number {
  try {
    const bytes = base64ToBytes(value);
    if (bytes.length < 2) return 0;
    const flags = bytes[0];
    return (flags & 0x01) ? ((bytes[2] << 8) | bytes[1]) : bytes[1];
  } catch { return 0; }
}

function parseTemperature(value: any): number {
  try {
    const bytes = base64ToBytes(value);
    if (bytes.length < 5) return 0;
    const mantissa = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16);
    const exponent = bytes[4] > 127 ? bytes[4] - 256 : bytes[4];
    const tempC = mantissa * Math.pow(10, exponent);
    return Math.round(tempC * 10) / 10;
  } catch { return 0; }
}

export function useBluetoothVitals() {
  const [status, setStatus] = useState<BluetoothStatus>('idle');
  const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null);
  const [vitals, setVitals] = useState<BluetoothVitals>({});
  const [error, setError] = useState<string | null>(null);
  const bleManagerRef = useRef<any>(null);
  const subscriptionsRef = useRef<any[]>([]);
  const connectedDeviceRef = useRef<any>(null);

  function getBleManager() {
    if (!bleManagerRef.current && Platform.OS !== 'web') {
      try {
        const { BleManager } = require('react-native-ble-plx');
        bleManagerRef.current = new BleManager();
      } catch {
        return null;
      }
    }
    return bleManagerRef.current;
  }

  const connect = useCallback(async () => {
    if (Platform.OS === 'web') {
      const isWebBtAvailable = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
      if (!isWebBtAvailable) {
        setStatus('unsupported');
        setError('Web Bluetooth not available. Use Chrome on Android or desktop.');
        return;
      }
      setStatus('scanning');
      try {
        const nav = navigator as any;
        const device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [HEART_RATE_SERVICE, HEALTH_THERM_SERVICE, 'heart_rate'],
        });
        setStatus('connecting');
        const server = await device.gatt.connect();
        setConnectedDevice({ id: device.id, name: device.name || 'Unknown' });
        setStatus('connected');
        device.addEventListener('gattserverdisconnected', () => {
          setStatus('idle');
          setConnectedDevice(null);
          setVitals({});
        });
        try {
          const hrService = await server.getPrimaryService(HEART_RATE_SERVICE);
          const hrChar = await hrService.getCharacteristic(HEART_RATE_CHAR);
          hrChar.addEventListener('characteristicvaluechanged', (e: any) => {
            const v = e.target.value;
            const flags = v.getUint8(0);
            const hr = (flags & 0x01) ? v.getUint16(1, true) : v.getUint8(1);
            setVitals(prev => ({ ...prev, heartRate: hr }));
          });
          await hrChar.startNotifications();
        } catch {}
      } catch (err: any) {
        if (err.name !== 'NotFoundError' && err.name !== 'AbortError') {
          setError(err.message || 'Bluetooth error');
          setStatus('error');
        } else {
          setStatus('idle');
        }
      }
      return;
    }

    const manager = getBleManager();
    if (!manager) {
      setStatus('unsupported');
      setError('Bluetooth not available on this device');
      return;
    }

    const hasPermission = await requestAndroidBlePermissions();
    if (!hasPermission) {
      setStatus('error');
      setError('Bluetooth permissions denied. Please allow in Settings.');
      return;
    }

    setStatus('scanning');
    setError(null);

    try {
      manager.startDeviceScan(
        [HEART_RATE_SERVICE],
        { allowDuplicates: false },
        async (err: any, device: any) => {
          if (err) {
            setStatus('error');
            setError(err.message || 'Scan failed');
            return;
          }
          if (!device) return;

          manager.stopDeviceScan();
          setStatus('connecting');

          try {
            const connected = await device.connect();
            await connected.discoverAllServicesAndCharacteristics();
            connectedDeviceRef.current = connected;
            setConnectedDevice({ id: connected.id, name: connected.name || 'Health Device' });
            setStatus('connected');

            const hrSub = connected.monitorCharacteristicForService(
              HEART_RATE_SERVICE,
              HEART_RATE_CHAR,
              (err: any, char: any) => {
                if (err || !char) return;
                const hr = parseHeartRate(char.value);
                if (hr > 0) setVitals(prev => ({ ...prev, heartRate: hr }));
              }
            );
            subscriptionsRef.current.push(hrSub);

            try {
              const tempSub = connected.monitorCharacteristicForService(
                HEALTH_THERM_SERVICE,
                TEMP_MEASUREMENT_CHAR,
                (err: any, char: any) => {
                  if (err || !char) return;
                  const temp = parseTemperature(char.value);
                  if (temp > 0) setVitals(prev => ({ ...prev, temperature: temp }));
                }
              );
              subscriptionsRef.current.push(tempSub);
            } catch {}

            connected.onDisconnected(() => {
              setStatus('idle');
              setConnectedDevice(null);
              setVitals({});
              connectedDeviceRef.current = null;
            });
          } catch (connectErr: any) {
            setStatus('error');
            setError(connectErr.message || 'Connection failed');
          }
        }
      );

      setTimeout(() => {
        if (status === 'scanning') {
          manager.stopDeviceScan();
          setStatus('error');
          setError('No BLE heart rate devices found nearby. Make sure device is powered on and in pairing mode.');
        }
      }, 15000);
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Bluetooth error');
    }
  }, [status]);

  const disconnect = useCallback(async () => {
    try {
      subscriptionsRef.current.forEach(sub => sub?.remove?.());
      subscriptionsRef.current = [];
      if (connectedDeviceRef.current) {
        await connectedDeviceRef.current.cancelConnection().catch(() => {});
        connectedDeviceRef.current = null;
      }
      const manager = getBleManager();
      if (manager) manager.stopDeviceScan();
    } catch {}
    setStatus('idle');
    setConnectedDevice(null);
    setVitals({});
  }, []);

  return {
    status,
    connectedDevice,
    vitals,
    error,
    isSupported: Platform.OS !== 'web' || (typeof navigator !== 'undefined' && 'bluetooth' in navigator),
    connect,
    disconnect,
  };
}
