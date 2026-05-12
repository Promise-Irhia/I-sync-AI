# I-Sync — Complete Code Flow Documentation

This document explains how every part of the I-Sync medical monitoring app is wired together, from the moment the app opens to the moment data appears on screen.

---

## 1. What I-Sync Is

I-Sync is a full-stack medical monitoring mobile application built with:

- **Frontend**: Expo React Native (TypeScript) — runs as a mobile app on iOS/Android and as a web app in the browser
- **Backend**: Express.js (TypeScript) on Node.js — REST API server
- **Database**: PostgreSQL — all persistent data
- **AI**: OpenAI GPT-4o — powers the health assistant and AI fall verification
- **SMS**: Twilio — sends emergency alerts on falls or critical heart rate

The app has two user roles:

| Role | Display label | Internal value | ID format |
|------|--------------|----------------|-----------|
| Patient | Patient | `'patient'` | `PAT-XXXXXXX` |
| Care Giver | Care Giver | `'doctor'` | `CGR-XXXXXXX` |

> Note: The internal role value and all API routes use `'doctor'` / `/(doctor)/` for legacy reasons. Only the visible text in the UI shows "Care Giver".

---

## 2. Server Startup Sequence

**File: `server/index.ts`**

When `npm run server:dev` is executed, the server starts in this exact order:

```
1. dotenv.config()              — loads .env into process.env
2. setupCors(app)               — allow Expo/browser origins
3. setupBodyParsing(app)        — parse JSON and form bodies
4. setupRequestLogging(app)     — log every /api/* request to console
5. configureExpoAndLanding(app) — serve landing page and Expo manifest
6. registerRoutes(app)          — mount all /api/* endpoints (routes.ts)
7. setupErrorHandler(app)       — global catch-all error handler
8. server.listen(5000, '0.0.0.0') — begin accepting connections
9. storage.initNutritionTables()  — create food/nutrition/water tables if missing
10. storage.initFallTable()       — create fall_events table if missing
11. storage.initMealPlanTables()  — create meal_plans/confirmations tables if missing
```

The server runs on port **5000** and accepts connections from any network interface (`0.0.0.0`). A reverse proxy exposes this to the internet over HTTPS.

### CORS Policy

The CORS middleware allows requests from:
- Any `localhost` port (Expo web dev server)
- `127.0.0.1` (same as localhost)
- `192.168.*`, `10.*`, `172.*` (LAN — physical devices on the same Wi-Fi)
- The value of `ALLOWED_ORIGIN` env var (for production domain)

Browser preflight OPTIONS requests are always answered with `200 OK`.

### How the Expo App Is Served

When a browser visits `/`, the server reads `server/templates/landing-page.html`, injects the real domain URLs, and returns it. This page shows a QR code for Expo Go.

When the Expo Go app opens on a phone, it sends a request to `/` with the header `expo-platform: ios` or `expo-platform: android`. The server detects this header and instead returns `static-build/<platform>/manifest.json` — a file that tells Expo Go where to download the JS bundle.

Static files (JS bundles, fonts, images) are served from `static-build/` and `assets/`.

---

## 3. Database Layer

**File: `server/storage.ts`**

All SQL queries live here. Routes never write SQL directly — they always call a `storage.*` function.

### Connection Pool

A PostgreSQL connection pool is created lazily the first time any query runs. The pool is a Proxy object so you can call `pool.query(...)` anywhere without importing `getPool()`.

```
DATABASE_URL env var  →  getPool()  →  new Pool({ connectionString, ssl })
```

- **Local DB** (URL contains `localhost`): SSL disabled
- **Cloud DB**: SSL enabled with `rejectUnauthorized: false`

### Database Tables

| Table | Created by | Purpose |
|-------|-----------|---------|
| `users` | Pre-existing schema | All accounts (patients + care givers) |
| `patient_profiles` | Pre-existing schema | Medical data for each patient |
| `vitals` | Pre-existing schema | Heart rate, blood pressure, SpO2, temperature readings |
| `activity_log` | Pre-existing schema | Audit trail of care giver edits |
| `appointments` | Pre-existing schema | Patient–care giver appointments |
| `prescriptions` | Pre-existing schema | Medications prescribed by care givers |
| `food_log` | `initNutritionTables()` | Manual food entries (legacy) |
| `nutrition_goals` | `initNutritionTables()` | Calorie/macro/water targets per patient |
| `water_log` | `initNutritionTables()` | Daily water glass count per patient |
| `fall_events` | `initFallTable()` | Accelerometer-detected falls + AI analysis results |
| `meal_plans` | `initMealPlanTables()` | Care giver–prescribed meals for a patient |
| `meal_confirmations` | `initMealPlanTables()` | Which meals the patient confirmed eating today |

### Key Design Decisions

**IDs**: Internal database IDs are 16-character hex strings (`randomBytes(8).toString('hex')`). Human-readable IDs (`PAT-XXXXXXX`, `CGR-XXXXXXX`) are generated at registration and stored in `unique_id`.

**Passwords**: Stored as SHA-256 hashes with a fixed salt (`isync_secure_salt_v1`). Never stored plain.

**Auth tokens**: Stored in a `Map<token, userId>` in memory. This is intentional — tokens expire on server restart, users re-login. Accounts persist in PostgreSQL.

**Row mappers**: Every table has a `rowTo*` function that converts PostgreSQL's `snake_case` column names to camelCase TypeScript objects. `sanitizeUser()` strips the password hash before any user object leaves the server.

---

## 4. Authentication Flow

### Registration

```
Mobile app  →  POST /api/auth/register { role, name, email, password, ... }
               ↓
           storage.registerUser()
               ↓ generates id (hex), uniqueId (PAT/CGR), passwordHash
               ↓ INSERT INTO users ...
               ↓ if patient: INSERT INTO patient_profiles (patient_id) ...
               ↓
           storage.loginUser() — auto-login after register
               ↓ generates 64-char hex token
               ↓ authTokensMap.set(token, userId)
               ↓
           Response: { user, token }
               ↓
Mobile app  →  AsyncStorage.setItem('isync_token', token)
            →  AsyncStorage.setItem('isync_user', JSON.stringify(user))
            →  router.replace('/(patient)') or '/(doctor)'
```

### Login

```
Mobile app  →  POST /api/auth/login { email, password }
               ↓
           SELECT * FROM users WHERE email = $1
           compare hashPassword(password) === stored hash
               ↓ if match: generate token, store in authTokensMap
               ↓
           Response: { user, token }
               ↓
Mobile app  →  AsyncStorage stores token + user
            →  Navigates to correct role home screen
```

### Token Validation on App Startup

Every time the Expo app starts, `AuthContext` runs `loadStoredAuth()`:

```
AsyncStorage.getItem('isync_token')  +  AsyncStorage.getItem('isync_user')
    ↓ if both exist:
GET /api/auth/me  { Authorization: Bearer <token> }
    ↓ if 200 OK:  restore session (setToken, setUser)
    ↓ if 401:     clear storage (token invalid — server restarted)
    ↓ if network error: trust stored data (offline mode)
```

### Every Protected API Request

```
Route handler uses: app.get('/api/...', authenticate, async (req, res) => { ... })
                                         ↑
                              authenticate middleware:
                              1. reads req.headers.authorization
                              2. strips "Bearer " prefix
                              3. storage.getUserByToken(token) → looks up authTokensMap
                              4. if found: attaches user to (req as any).user, calls next()
                              5. if not found: returns 401
```

---

## 5. Frontend Architecture

### File Structure

```
app/
  _layout.tsx          — Root layout: AuthProvider + font loading + route guard
  index.tsx            — Splash/redirect screen
  (auth)/
    login.tsx          — Login form
    register.tsx       — Registration form with role selector
  (patient)/
    _layout.tsx        — Patient tab navigator (Home, Nutrition, Medications, etc.)
    index.tsx          — Patient home: vitals dashboard + live charts
    nutrition.tsx      — Approved meal plan + water tracker + AI nutrition coach
    medications.tsx    — Prescription list with reminder times
    appointments.tsx   — Book and view appointments
    fall-detection.tsx — Accelerometer monitoring + AI fall verification
    assistant.tsx      — GPT-4o patient health assistant
    profile.tsx        — Patient profile editor
  (doctor)/
    _layout.tsx        — Care giver tab navigator
    index.tsx          — Care giver home: patient search
    patient/[id].tsx   — Patient detail: vitals, prescriptions, meal plan, nutrition goals
    appointments.tsx   — Care giver appointment management
    prescriptions.tsx  — All prescriptions written by this care giver
    assistant.tsx      — GPT-4o clinical decision support assistant
    profile.tsx        — Care giver profile

context/
  AuthContext.tsx       — Global auth state + login/register/logout functions

lib/
  query-client.ts       — apiRequest() helper + getApiUrl() for dynamic base URL
```

### Route Guard (app/_layout.tsx)

The root layout wraps everything in `<AuthProvider>`. It watches `user` and `isLoading` from `useAuth()`:

```
isLoading === true  →  show splash/loading screen
isLoading === false and user === null  →  router.replace('/(auth)/login')
isLoading === false and user.role === 'patient'  →  router.replace('/(patient)')
isLoading === false and user.role === 'doctor'   →  router.replace('/(doctor)')
```

This means unauthorised users can never see protected screens.

### API Base URL (lib/query-client.ts)

Because the app runs on both web and native, it can't hardcode `http://localhost:5000`. The `getApiUrl()` function returns:
- On web: a relative URL (empty string, so requests go to the same origin)
- On native: the `EXPO_PUBLIC_API_URL` env var or the server's public domain

`apiRequest(method, path, body)` wraps `fetch()` with the correct base URL and JSON headers.

---

## 6. Patient Features — Code Flow

### Vitals Dashboard

```
Patient opens app  →  (patient)/index.tsx  mounts
    ↓  useEffect → GET /api/patient/vitals?limit=24
    ↓  GET /api/patient/profile
    ↓  GET /api/nutrition/goals
    ↓
Data returned → renders:
    - Line charts (heart rate, blood pressure, SpO2, temperature)
    - Current vitals card
    - Profile summary (blood type, conditions, allergies)
    - Medication reminders
    - Nutrition goal progress bars

Patient taps "Record Vitals":
    ↓  POST /api/patient/vitals { heartRate, systolicBP, diastolicBP, spo2, temperature }
    ↓  Server: storage.addVitalsRecord() → INSERT INTO vitals
    ↓  Server: prunes to 200 records max
    ↓  Response: { record }
    ↓  Client refreshes vitals list
```

If heart rate exceeds 140 bpm, the vitals screen automatically:
```
POST /api/patient/hr-alert { heartRate, emergencyContacts, locationLat, locationLng }
    ↓  Server sends Twilio SMS to emergency contacts
```

### Nutrition Screen — Approved Meals

```
(patient)/nutrition.tsx  mounts
    ↓  GET /api/patient/meal-plan
       Response: { meals: [...], confirmed: ['mealId1', 'mealId2'] }
    ↓  GET /api/nutrition/goals
       Response: { goals: { calories, protein, carbs, fat, water, doctorNote } }
    ↓  GET /api/nutrition/water?date=YYYY-MM-DD
       Response: { glasses: 3 }

Renders:
    - Care giver's note (from nutrition_goals.doctor_note)
    - Daily progress bar (confirmed meals / total meals)
    - Each meal card with: name, scheduled time, calories, checkmark button
    - Water intake tracker (+ and - buttons)
    - AI Nutrition Coach chat button

Patient taps checkmark on a meal:
    ↓  POST /api/patient/meal-plan/:mealId/confirm
    ↓  storage.confirmMeal() → INSERT INTO meal_confirmations ON CONFLICT DO NOTHING
    ↓  UI updates confirmed array locally

Patient taps water + :
    ↓  PUT /api/nutrition/water { glasses: currentCount + 1, date }
    ↓  storage.setWaterCount() → UPSERT water_log (clamped 0-12)
```

### Fall Detection

```
(patient)/fall-detection.tsx  mounts
    ↓  Requests Accelerometer permission and Location permission
    ↓  Starts accelerometer subscription at 50ms intervals
    ↓  Maintains rolling buffer of last 30 readings

Every reading:
    - Computes magnitude = √(x² + y² + z²)
    - If magnitude > 2.5g  AND  no alert in last 30 seconds:
        ↓  POST /api/patient/fall-events { accelerationX, Y, Z, magnitude, locationLat, locationLng }
           → storage.logFallEvent() → INSERT INTO fall_events
           Response: { eventId }
        ↓  Show 10-second countdown alert ("Are you OK?")
        ↓  If not dismissed in 10s:
            ↓  Camera captures a frame (if permission granted)
            ↓  POST /api/patient/verify-fall {
                 image: base64,
                 eventId,
                 accelerationHistory: last30readings,
                 source: 'phone'
               }
               → GPT-4o analyses image posture + motion signature
               → Returns { result, confidence, reason }
            ↓  If result === 'fall_confirmed':
               - Server automatically sends Twilio SMS to emergency contacts
               - Client shows "FALL CONFIRMED" alert with confidence %
            ↓  If result === 'false_alarm':
               - Show "No fall detected" toast
```

### AI Health Assistant

```
(patient)/assistant.tsx
    ↓  User types a message
    ↓  POST /api/chat { messages: [...], mode: 'patient' }
       Server sets SSE headers, calls streamChat()
    ↓  GPT-4o streams response token by token
    ↓  Client reads SSE stream:
       each `data: {"content": "word"}` event → appends to message bubble
       `data: [DONE]` → marks stream complete
```

---

## 7. Care Giver Features — Code Flow

### Patient Search & Detail

```
Care giver tabs to Search in (doctor)/index.tsx
    ↓  Types patient name or PAT-ID
    ↓  GET /api/doctor/search?q=john
       → storage.searchPatients() → SELECT WHERE name LIKE $1 OR unique_id LIKE $1
    ↓  Taps a patient

(doctor)/patient/[id].tsx  loads
    ↓  GET /api/doctor/patient/:patientId
       Response: { patient, profile, vitals, activityLog, prescriptions }
       (5 parallel queries on the server combined into one API call)

Renders tabs:
    - Overview: profile, blood type, allergies, conditions, emergency contact
    - Vitals: line charts + last readings
    - Prescriptions: list + "Add Prescription" button
    - Meal Plan: list of approved meals + "Add Meal" button
    - Nutrition Goals: calorie/macro sliders + care giver note field
    - Activity Log: timeline of all changes made by care givers
```

### Adding a Meal to a Patient's Plan

```
Care giver taps "+ Add Meal" in the Meal Plan tab
    ↓  Modal opens with fields: meal type, food name, scheduled time, calories, notes
    ↓  POST /api/doctor/patient/:patientId/meal-plan {
         mealType, foodName, scheduledTime, calories, notes
       }
       → storage.addMealPlan() → INSERT INTO meal_plans
    ↓  Response: { meal }
    ↓  UI adds meal to list immediately

Care giver taps trash icon on a meal:
    ↓  DELETE /api/doctor/patient/:patientId/meal-plan/:mealId
       → storage.deleteMealPlan() → DELETE FROM meal_plans + DELETE FROM meal_confirmations
    ↓  UI removes meal from list
```

### Setting Nutrition Goals

```
Care giver edits calorie/macro sliders in Nutrition Goals tab
    ↓  PUT /api/doctor/patient/:patientId/nutrition-goals {
         calories, protein, carbs, fat, water, doctorNote
       }
       → storage.setNutritionGoals() → UPSERT nutrition_goals
    ↓  Patient immediately sees updated goals and note in their Nutrition screen
```

### Prescribing Medication

```
Care giver taps "+ Add Prescription"
    ↓  POST /api/doctor/patient/:patientId/prescriptions {
         medicationName, dosage, frequency, times, notes
       }
       → storage.prescribeMedication()
       → INSERT INTO prescriptions
       → INSERT INTO activity_log (field='prescription') — records audit event
    ↓  Patient sees new prescription in their Medications screen
```

---

## 8. AI Fall Verification — Deep Dive

The fall verification system uses three different modes depending on what data is available:

### Mode 1: Camera + Motion (Best Accuracy)

GPT-4o receives:
- A JPEG image from the phone camera (analysed for body posture)
- A text summary of the last 30 accelerometer readings (free-fall + impact signature)

The AI is asked to confirm that **both** the posture AND the motion pattern match a fall.

### Mode 2: Camera Only

GPT-4o receives only the image. It determines if the person appears to be lying on the floor in an abnormal position.

### Mode 3: Motion Only (BLE Wearable or Camera Unavailable)

GPT-4o receives only the accelerometer text summary. It looks for the fall pattern:
1. Free-fall phase: magnitude drops below 0.5g (weightlessness)
2. Impact spike: magnitude spikes above 2.5g within 2.5 seconds
3. Post-impact: erratic readings (person is on the floor)

### Response Format

The AI is instructed to respond only with:
```json
{"result": "fall_confirmed", "confidence": 85, "reason": "Person is lying on the floor with arms extended. Motion data shows a classic free-fall/impact signature."}
```

### Emergency SMS Trigger

If `result === 'fall_confirmed'` **and** Twilio is configured:
1. Fetch patient profile (emergency contact phone number)
2. Fetch latest vitals (to include in SMS)
3. Send SMS to: emergency contact + patient's own phone + any contacts in request body
4. SMS content: patient name, ID, confidence %, vitals, Google Maps link

---

## 9. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | For AI features | GPT-4o chat + fall verification |
| `TWILIO_ACCOUNT_SID` | For SMS | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | For SMS | Twilio API secret |
| `TWILIO_FROM_NUMBER` | For SMS | Phone number to send SMS from |
| `USDA_API_KEY` | Optional | Food nutrition database (falls back to local DB) |
| `ALLOWED_ORIGIN` | Optional | Additional CORS origin to allow |
| `PORT` | Optional | Server port (defaults to 5000) |

All variables are loaded by `dotenv.config()` at the very top of `server/index.ts` before any other code runs.

---

## 10. Data Flow Summary Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXPO MOBILE APP                             │
│                                                                     │
│  AuthContext ───────────────────────────────────────────────────── │
│  (user, token, login, register, logout)                            │
│                                                                     │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │  (auth)/    │  │   (patient)/     │  │     (doctor)/         │ │
│  │  login.tsx  │  │   index.tsx      │  │     index.tsx         │ │
│  │  register   │  │   nutrition.tsx  │  │     patient/[id].tsx  │ │
│  └─────────────┘  │   medications   │  │     prescriptions     │ │
│                   │   appointments  │  │     appointments      │ │
│                   │   fall-detect   │  │     assistant         │ │
│                   │   assistant     │  └───────────────────────┘ │
│                   └──────────────────┘                            │
│                                                                     │
│  All screens use: apiRequest(method, path, body)                   │
│  with: { Authorization: Bearer <token> } header                   │
└─────────────────────────────────────────────────────────────────────┘
                              │ HTTP/HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (port 5000)                      │
│                                                                     │
│  server/index.ts ── CORS ── body parser ── request logger          │
│                                                                     │
│  server/routes.ts                                                   │
│  ├─ /api/auth/*          (register, login, logout, me)             │
│  ├─ /api/patient/*       (profile, vitals, appointments, ...)      │
│  ├─ /api/doctor/*        (search, patient detail, prescriptions)   │
│  ├─ /api/nutrition/*     (food log, goals, water, AI coach)        │
│  ├─ /api/chat            (GPT-4o health assistant, SSE stream)     │
│  └─ /api/patient/verify-fall (GPT-4o fall analysis)               │
│                                                                     │
│  server/storage.ts ── all SQL queries ── PostgreSQL connection pool│
└─────────────────────────────────────────────────────────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
        PostgreSQL            OpenAI GPT-4o         Twilio SMS
        (all data)            (chat + fall)        (emergencies)
```

---

## 11. Key Design Patterns

### Error Handling
- Every route handler wraps async work in `try/catch`
- Server errors return `{ error: message }` JSON with the appropriate HTTP status code
- Process-level `uncaughtException` and `unhandledRejection` handlers prevent the server from crashing on unexpected errors

### Idempotent DB Operations
- `meal_confirmations` uses `ON CONFLICT DO NOTHING` — tapping confirm twice is safe
- `nutrition_goals` uses `ON CONFLICT DO UPDATE` — always upserts
- `water_log` uses `ON CONFLICT DO UPDATE` — always upserts
- `patient_profiles` uses `ON CONFLICT DO UPDATE` — always upserts

### Data Pruning
- Vitals are automatically pruned to 200 records per patient after every insert
- This prevents the `vitals` table from growing unboundedly

### Parallel DB Queries
- The patient detail endpoint runs 5 queries in parallel (user, profile, vitals, activity log, prescriptions) via individual `await` calls — Express handles these concurrently
- The patient meal plan endpoint fetches meals + confirmations with `Promise.all()`

### SSE Streaming
- Both `/api/chat` and `/api/nutrition/ai-chat` use Server-Sent Events
- The client reads the stream with `fetch()` and processes each `data: {...}` line
- The server writes `data: [DONE]\n\n` to signal end of stream

### Role-Based Access Control
- Care giver routes check `user.role !== 'doctor'` and return `403 Forbidden` if the caller is a patient
- This is enforced in every `/api/doctor/*` route handler
- The `authenticate` middleware runs first for all protected routes

---

*End of I-Sync code flow documentation.*
