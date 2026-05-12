import { useEffect, useRef, useState, useCallback } from 'react';

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

function getWsUrl(patientId: string): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN || 'localhost:5000';
  const isLocal =
    domain.startsWith('localhost') || domain.startsWith('127.0.0.1') || domain.startsWith('192.168.');
  const scheme = isLocal ? 'ws' : 'wss';
  return `${scheme}://${domain}?patientId=${encodeURIComponent(patientId)}`;
}

export function useWebSocket(patientId: string | null | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<WSStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<any>(null);

  const connect = useCallback(() => {
    if (!patientId || !mountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    try {
      const url = getWsUrl(patientId);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        if (mountedRef.current) setStatus('connected');
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          setLastMessage(JSON.parse(event.data as string));
        } catch {}
      };

      ws.onerror = () => {
        if (mountedRef.current) setStatus('error');
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStatus('disconnected');
        reconnectRef.current = setTimeout(connect, 3000);
      };
    } catch {
      if (mountedRef.current) setStatus('error');
    }
  }, [patientId]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { status, lastMessage, send };
}
