// ─────────────────────────────────────────────────────────────────────────────
// context/AuthContext.tsx  —  Global authentication state for the Expo app
//
// This file does three things:
//   1. Defines the AuthContext shape (what data/functions are available app-wide)
//   2. Provides the AuthProvider component that wraps the entire app
//   3. Exports the useAuth() hook so any screen can access auth state
//
// Persistence: tokens are saved to AsyncStorage so the user stays logged in
// across app restarts. On startup, the stored token is validated against the
// server. If the server rejects it (server restarted), the user is logged out.
// ─────────────────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Device persistent storage
import { router } from 'expo-router';                                  // Navigation helper
import { apiRequest, getApiUrl } from '@/lib/query-client';           // HTTP request helpers
import { fetch } from 'expo/fetch';                                    // Expo-patched fetch (works on native)

// ── Type Definitions ──────────────────────────────────────────────────────────

// The user object received from the server (password stripped out)
export type UserRole = 'patient' | 'doctor';

export type AuthUser = {
  id: string;          // Internal UUID hex
  role: UserRole;      // 'patient' or 'doctor' (care giver)
  uniqueId: string;    // Human-readable: PAT-XXXXXXX or CGR-XXXXXXX
  name: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
};

// Data needed to register a new account
export type RegisterData = {
  role: UserRole;
  name: string;
  email: string;
  password: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
};

// The complete shape of what the context exposes to child components
type AuthContextValue = {
  user: AuthUser | null;       // null when not logged in
  token: string | null;        // Bearer token for API requests
  isLoading: boolean;          // true while checking stored auth on startup
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  authHeader: () => Record<string, string>; // Returns { Authorization: 'Bearer ...' } or {}
  handleUnauthorized: () => Promise<void>;  // Called when server returns 401 — logs out
};

// ── Context Creation ──────────────────────────────────────────────────────────
// Create the context with null as the default — the useAuth() hook enforces
// that it's only called inside an AuthProvider.
const AuthContext = createContext<AuthContextValue | null>(null);

// ── AuthProvider Component ────────────────────────────────────────────────────
// Wrap the entire app with this so every screen can access auth state.
// Defined in app/_layout.tsx as: <AuthProvider><Stack /></AuthProvider>
export function AuthProvider({ children }: { children: ReactNode }) {
  // Core auth state
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Starts true until stored auth is checked

  // Prevents multiple simultaneous 401 handlers from all trying to redirect
  const handlingUnauthorized = useRef(false);

  // On mount, attempt to restore a previous session from AsyncStorage
  useEffect(() => {
    loadStoredAuth();
  }, []);

  // ── Session Restore ─────────────────────────────────────────────────────────
  // Reads token + user from device storage and validates the token with the server.
  // If valid → restore session. If invalid → clear storage (server likely restarted).
  async function loadStoredAuth() {
    try {
      // Read both values in parallel for speed
      const [storedToken, storedUser] = await Promise.all([
        AsyncStorage.getItem('isync_token'),
        AsyncStorage.getItem('isync_user'),
      ]);
      if (storedToken && storedUser) {
        const baseUrl = getApiUrl();
        try {
          // Validate the token against the server before trusting it
          const res = await fetch(`${baseUrl}api/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` },
          });
          if (res.ok) {
            // Token is still valid — restore the session
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
          } else {
            // Token was rejected (e.g. server restarted) — clear storage
            await AsyncStorage.multiRemove(['isync_token', 'isync_user']);
          }
        } catch {
          // Network error (e.g. no internet on startup) — trust stored data offline
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        }
      }
    } catch (e) {
      console.error('Auth load error:', e);
    } finally {
      // Always mark loading as done so the route guard can render the correct screen
      setIsLoading(false);
    }
  }

  // ── Unauthorized Handler ────────────────────────────────────────────────────
  // Called by API request helpers when the server returns a 401.
  // Clears all stored auth and redirects to the login screen.
  // The ref guard prevents multiple simultaneous calls from causing a redirect loop.
  async function handleUnauthorized() {
    if (handlingUnauthorized.current) return; // Already handling — skip duplicate call
    handlingUnauthorized.current = true;
    try {
      await AsyncStorage.multiRemove(['isync_token', 'isync_user']);
      setToken(null);
      setUser(null);
      router.replace('/(auth)/login'); // Navigate to login screen
    } finally {
      handlingUnauthorized.current = false;
    }
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  // Sends credentials to the server, receives a token, and persists everything.
  async function login(email: string, password: string) {
    const res = await apiRequest('POST', '/api/auth/login', { email, password });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    // Persist to device storage so the session survives app restarts
    await AsyncStorage.setItem('isync_token', data.token);
    await AsyncStorage.setItem('isync_user', JSON.stringify(data.user));
    // Update React state so components re-render immediately
    setToken(data.token);
    setUser(data.user);
  }

  // ── Register ────────────────────────────────────────────────────────────────
  // Sends registration data, auto-logs in with the returned token.
  async function register(registerData: RegisterData) {
    const res = await apiRequest('POST', '/api/auth/register', registerData);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    // Server auto-logs in after register — store the token immediately
    await AsyncStorage.setItem('isync_token', data.token);
    await AsyncStorage.setItem('isync_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  // Calls the server logout endpoint (invalidates the token server-side),
  // then clears all local state and storage.
  async function logout() {
    try {
      if (token) {
        const baseUrl = getApiUrl();
        // Tell the server to invalidate the token — best-effort, don't fail if offline
        await fetch(`${baseUrl}api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {} // Silently ignore network errors on logout
    // Always clear local state regardless of server response
    await AsyncStorage.multiRemove(['isync_token', 'isync_user']);
    setToken(null);
    setUser(null);
  }

  // ── Auth Header Helper ──────────────────────────────────────────────────────
  // Returns the Authorization header object for use in fetch/apiRequest calls.
  // Returns an empty object if not logged in (unauthenticated requests).
  function authHeader(): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // ── Memoised Context Value ──────────────────────────────────────────────────
  // useMemo prevents a new object reference on every render, which would cause
  // all consumers of useAuth() to re-render unnecessarily.
  const value = useMemo(
    () => ({ user, token, isLoading, login, register, logout, authHeader, handleUnauthorized }),
    [user, token, isLoading] // Only rebuild when these core values change
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── useAuth Hook ──────────────────────────────────────────────────────────────
// Call this in any screen or component to access the logged-in user and auth functions.
// Throws a clear error if called outside AuthProvider (helps catch setup mistakes early).
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
