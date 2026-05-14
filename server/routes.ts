// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// server/routes.ts  —  All Express API route definitions
// Every HTTP endpoint the mobile app calls is registered here.
// This file imports `storage` for DB work and the AI/SMS helpers for smart features.
// ─────────────────────────────────────────────────────────────────────────────

import type { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'node:http';
import OpenAI from 'openai';
import twilio from 'twilio';
import { storage } from './storage';

// ── Twilio SMS Client (lazy-loaded) ───────────────────────────────────────────
// Twilio is used to send emergency SMS messages when a fall or heart-rate spike
// is detected. The client is created lazily so missing env vars don't crash startup.
let _twilio: ReturnType<typeof twilio> | null | undefined = undefined;
function getTwilio() {
  if (_twilio === undefined) {
    // Only initialise if all three required env vars are present
    _twilio = (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
    )
      ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      : null; // null = Twilio not configured, SMS features disabled
  }
  return _twilio;
}

// Sends an emergency SMS to a single phone number with patient vitals and GPS link
export async function sendEmergencySMS(
  toNumber: string,
  patientName: string,
  patientId: string,
  vitals: { hr?: number; bp?: string; spo2?: number } | null,
  locationLat?: number,
  locationLng?: number,
  confidence?: number,
) {
  const twilioClient = getTwilio();
  if (!twilioClient) return; // Silently skip if Twilio is not configured

  // Build a Google Maps link only if GPS coordinates are available
  const mapsLink = locationLat && locationLng
    ? ` Location: https://maps.google.com/?q=${locationLat},${locationLng}`
    : '';

  // Include vitals in the SMS body if they were recorded recently
  const vitalsStr = vitals
    ? ` Vitals at time of fall — HR: ${vitals.hr ?? '?'} bpm, BP: ${vitals.bp ?? '?'}, SpO2: ${vitals.spo2 ?? '?'}%.`
    : '';

  const confirmedBy = confidence != null
    ? `detected with ${confidence}% AI confidence`
    : `confirmed by the patient`;
  const body =
    `🚨 FALL ALERT — ${patientName} (ID: ${patientId}) has fallen (${confirmedBy}).${vitalsStr}${mapsLink}` +
    ` Please check on them immediately or call 911.`;

  // Send via Twilio — throws if delivery fails (caller should handle)
  await twilioClient.messages.create({
    body,
    from: process.env.TWILIO_FROM_NUMBER!,
    to: toNumber,
  });
}

// ── OpenAI Client (lazy-loaded) ───────────────────────────────────────────────
// GPT-4o powers the AI health assistant and AI fall verification.
// Lazy-loaded so missing API key doesn't crash startup — AI features degrade gracefully.
let _openai: OpenAI | null | undefined = undefined;
function getOpenAI(): OpenAI | null {
  if (_openai === undefined) {
    _openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null; // null = AI features disabled (will show quota/config error to user)
  }
  return _openai;
}

// ── Server-Sent Events (SSE) AI Streaming ─────────────────────────────────────
// Streams GPT-4o responses token-by-token to the client using SSE format.
// SSE is used instead of WebSockets because it's simpler for one-way AI streaming.
async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  res: any
) {
  // Build the list of AI providers to try (OpenAI first, fallback if quota exceeded)
  const clients: { client: OpenAI; model: string }[] = [];
  const aiClient = getOpenAI();
  if (aiClient) clients.push({ client: aiClient, model: 'gpt-4o' });

  for (let i = 0; i < clients.length; i++) {
    const { client, model } = clients[i];
    try {
      // Create a streaming completion — each chunk arrives as a delta
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages] as any,
        stream: true,
        max_completion_tokens: 8192,
      });
      // Write each token to the SSE stream as it arrives
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
      // Signal the client that the stream is complete
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    } catch (err: any) {
      const isQuota = err?.status === 429 || err?.code === 'insufficient_quota';
      // If quota exceeded and a fallback exists, try the next provider
      if (isQuota && i < clients.length - 1) {
        console.log(`Primary AI key quota exceeded, falling back to secondary key...`);
        continue;
      }
      // If quota exceeded and no fallback, send a helpful user-facing message
      if (isQuota) {
        res.write(`data: ${JSON.stringify({ content: "⚠️ AI quota exceeded. Please add credits to your OpenAI account at platform.openai.com/settings/billing, or contact support." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      throw err; // Non-quota errors bubble up to the caller's try/catch
    }
  }

  // If no AI clients were configured at all, tell the user
  if (clients.length === 0) {
    res.write(`data: ${JSON.stringify({ content: "⚠️ No AI service configured. Please add an OpenAI API key." })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ── Expo Push Notification Helper ────────────────────────────────────────────
// Sends push notifications to one or more Expo push tokens via the Expo Push API.
// No SDK needed — just a plain HTTP POST to Expo's endpoint.
export async function sendExpoPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, any> = {},
): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map(to => ({
    to, title, body, data, sound: 'default', priority: 'high',
  }));
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  });
}

// ── Authentication Middleware ──────────────────────────────────────────────────
// Every protected route uses this as the second argument: app.get('/api/...', authenticate, ...)
// It reads the Bearer token from the Authorization header and attaches the user to req.user
async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const user = await storage.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  (req as any).user = user; // Attach user so route handlers can access it via (req as any).user
  next();
}

// ── Route Registration ─────────────────────────────────────────────────────────
// All routes are registered inside this exported async function.
// `server/index.ts` calls this and passes the Express app.
export async function registerRoutes(app: Express) {

  // ── Health / Keep-alive ──────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // ── Push Token Registration ───────────────────────────────────────────────────
  // Caregivers call this on login to register their Expo push token.
  // The token is stored in the DB and used to send push notifications on fall events.
  app.post('/api/push-token', authenticate, async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'token required' });
      const user = (req as any).user;
      await storage.savePushToken(user.id, token);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Auth Routes ─────────────────────────────────────────────────────────────

  // POST /api/auth/register — creates a new patient or care giver account
  // Returns the new user object + session token (auto-logs in after register)
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { role, name, email, password, phone, dateOfBirth, gender } = req.body;
      if (!role || !name || !email || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const user = await storage.registerUser({ role, name, email, password, phone, dateOfBirth, gender });
      // Immediately log the new user in so the client receives a usable token
      const loginResult = await storage.loginUser(email, password);
      res.status(201).json({ user: loginResult.user, token: loginResult.token });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/auth/login — checks credentials, returns user + session token
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await storage.loginUser(email, password);
      res.json({ user: result.user, token: result.token });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  });

  // POST /api/auth/logout — invalidates the session token
  app.post('/api/auth/logout', authenticate, async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) await storage.logoutUser(token);
    res.json({ success: true });
  });

  // GET /api/auth/me — returns the currently logged-in user (used on app startup to validate token)
  app.get('/api/auth/me', authenticate, async (req, res) => {
    res.json({ user: (req as any).user });
  });

  // ── Patient — Own Profile & Medical Data ────────────────────────────────────

  // GET /api/patient/profile — patient fetches their own medical profile
  app.get('/api/patient/profile', authenticate, async (req, res) => {
    const user = (req as any).user;
    const profile = await storage.getPatientProfile(user.id);
    res.json({ profile });
  });

  // PUT /api/patient/profile — patient updates their own profile (no audit log)
  app.put('/api/patient/profile', authenticate, async (req, res) => {
    const user = (req as any).user;
    try {
      const updated = await storage.updatePatientProfile(user.id, req.body);
      res.json({ profile: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/patient/vitals — patient submits a new vitals reading from their device
  app.post('/api/patient/vitals', authenticate, async (req, res) => {
    const user = (req as any).user;
    try {
      const record = await storage.addVitalsRecord(user.id, req.body);
      res.status(201).json({ record });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/patient/vitals — patient fetches their own vitals history for charting
  app.get('/api/patient/vitals', authenticate, async (req, res) => {
    const user = (req as any).user;
    const limit = parseInt(req.query.limit as string) || 24;
    const history = await storage.getVitalsHistory(user.id, limit);
    res.json({ history });
  });

  // GET /api/patient/activity-log — patient sees the audit trail of care giver edits
  app.get('/api/patient/activity-log', authenticate, async (req, res) => {
    const user = (req as any).user;
    const log = await storage.getActivityLog(user.id);
    res.json({ log });
  });

  // GET /api/patient/appointments — patient's own appointment list
  app.get('/api/patient/appointments', authenticate, async (req, res) => {
    const user = (req as any).user;
    const appointments = await storage.getPatientAppointments(user.id);
    res.json({ appointments });
  });

  // POST /api/patient/appointments — patient books an appointment with a care giver
  // Status starts as 'pending' until the care giver confirms
  app.post('/api/patient/appointments', authenticate, async (req, res) => {
    const user = (req as any).user;
    try {
      const { doctorId, doctorName, date, time, specialty, notes } = req.body;
      if (!doctorId || !date || !time) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const appt = await storage.bookAppointment({
        patientId: user.id,
        patientName: user.name,
        doctorId,
        doctorName,
        date,
        time,
        specialty: specialty || 'General',
        notes: notes || '',
        status: 'pending', // Defaults to pending — care giver must confirm
      });
      res.status(201).json({ appointment: appt });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/patient/appointments/:id — patient cancels their own appointment
  app.delete('/api/patient/appointments/:id', authenticate, async (req, res) => {
    const user = (req as any).user;
    await storage.cancelAppointment(req.params.id, user.id);
    res.json({ success: true });
  });

  // GET /api/patient/prescriptions — patient views their medication list
  app.get('/api/patient/prescriptions', authenticate, async (req, res) => {
    const user = (req as any).user;
    const prescriptions = await storage.getPatientPrescriptions(user.id);
    res.json({ prescriptions });
  });

  // ── Doctor (Care Giver) Routes ──────────────────────────────────────────────
  // All routes below are protected with a role check: user.role === 'doctor'
  // The display label is "Care Giver" but the internal role value stays 'doctor'.

  // GET /api/doctors — patient screens use this to list all care givers for booking
  app.get('/api/doctors', authenticate, async (req, res) => {
    const doctors = await storage.getAllDoctors();
    res.json({ doctors });
  });

  // GET /api/doctor/search?q= — care giver searches patients by name or PAT-ID
  app.get('/api/doctor/search', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const query = (req.query.q as string) || '';
    const patients = await storage.searchPatients(query);
    res.json({ patients });
  });

  // GET /api/doctor/appointments — care giver's own appointment list
  app.get('/api/doctor/appointments', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const appointments = await storage.getDoctorAppointments(user.id);
    res.json({ appointments });
  });

  // POST /api/doctor/appointments — care giver books an appointment on behalf of a patient
  // Status is immediately 'confirmed' since the care giver initiated it
  app.post('/api/doctor/appointments', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const { patientId, date, time, specialty, notes } = req.body;
      if (!patientId || !date || !time) return res.status(400).json({ error: 'patientId, date and time are required' });
      const patient = await storage.getPatientById(patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });
      const appt = await storage.bookAppointment({
        patientId: patient.id,
        patientName: patient.name,
        doctorId: user.id,
        doctorName: user.name,
        date,
        time,
        specialty: specialty || 'General',
        notes: notes || '',
        status: 'confirmed', // Care giver-initiated appointments are auto-confirmed
      });
      res.status(201).json({ appointment: appt });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // PUT /api/doctor/appointments/:id — care giver updates appointment status (confirm/cancel)
  app.put('/api/doctor/appointments/:id', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const { status } = req.body;
      const appt = await storage.updateAppointmentStatus(req.params.id, status);
      res.json({ appointment: appt });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/doctor/patient/:patientId — full patient snapshot used by the care giver detail screen
  // Returns: user info, medical profile, last 24 vitals, activity log, prescriptions
  app.get('/api/doctor/patient/:patientId', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const patient = await storage.getPatientById(req.params.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    const profile = await storage.getPatientProfile(req.params.patientId);
    const vitals = await storage.getVitalsHistory(req.params.patientId, 24);
    const activityLog = await storage.getActivityLog(req.params.patientId);
    const prescriptions = await storage.getPatientPrescriptions(req.params.patientId);
    res.json({ patient, profile, vitals, activityLog, prescriptions });
  });

  // PUT /api/doctor/patient/:patientId — care giver edits a patient's medical profile
  // Every changed field is written to the activity_log table for auditing
  app.put('/api/doctor/patient/:patientId', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const updated = await storage.updatePatientProfile(
        req.params.patientId,
        req.body,
        user.id,   // Pass care giver ID so changes are attributed correctly
        user.name
      );
      res.json({ profile: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/doctor/patient/:patientId/vitals — care giver views a patient's vitals chart
  app.get('/api/doctor/patient/:patientId/vitals', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const limit = parseInt(req.query.limit as string) || 24;
    const history = await storage.getVitalsHistory(req.params.patientId, limit);
    res.json({ history });
  });

  // GET /api/doctor/patient/:patientId/activity-log — care giver views audit trail of changes
  app.get('/api/doctor/patient/:patientId/activity-log', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const log = await storage.getActivityLog(req.params.patientId);
    res.json({ log });
  });

  // GET /api/doctor/prescriptions — care giver views all prescriptions they've written
  app.get('/api/doctor/prescriptions', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const prescriptions = await storage.getDoctorPrescriptions(user.id);
    res.json({ prescriptions });
  });

  // POST /api/doctor/patient/:patientId/prescriptions — care giver prescribes a medication
  app.post('/api/doctor/patient/:patientId/prescriptions', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const { medicationName, dosage, frequency, times, notes } = req.body;
      if (!medicationName || !dosage) {
        return res.status(400).json({ error: 'Missing medication name or dosage' });
      }
      const rx = await storage.prescribeMedication({
        patientId: req.params.patientId,
        doctorId: user.id,
        doctorName: user.name,
        medicationName,
        dosage,
        frequency: frequency || 'Once daily',
        times: times || ['08:00'],  // Default to 8am reminder if no times provided
        notes: notes || '',
      });
      res.status(201).json({ prescription: rx });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/doctor/patient/:patientId/prescriptions/:rxId — removes a prescription
  app.delete('/api/doctor/patient/:patientId/prescriptions/:rxId', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    await storage.deletePrescription(req.params.rxId, user.id);
    res.json({ success: true });
  });

  // GET /api/doctor/patient/:patientId/nutrition-goals — care giver reads a patient's goals
  app.get('/api/doctor/patient/:patientId/nutrition-goals', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const goals = await storage.getNutritionGoals(req.params.patientId);
    res.json({ goals });
  });

  // PUT /api/doctor/patient/:patientId/nutrition-goals — care giver sets macro/calorie targets
  app.put('/api/doctor/patient/:patientId/nutrition-goals', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const { calories, protein, carbs, fat, water, doctorNote } = req.body;
      const goals = await storage.setNutritionGoals({
        patientId: req.params.patientId,
        calories: Number(calories) || 2000,
        protein: Number(protein) || 120,
        carbs: Number(carbs) || 250,
        fat: Number(fat) || 65,
        water: Number(water) || 8,
        doctorNote: doctorNote || '',
      });
      res.json({ goals });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ── AI Activity Suggestions ──────────────────────────────────────────────────
  // POST /api/patient/activity-suggestions — returns structured elderly-friendly
  // activity suggestions based on the patient's current vitals using GPT-4o.
  app.post('/api/patient/activity-suggestions', authenticate, async (req, res) => {
    const { heartRate, bloodPressure, spo2, temperature } = req.body;
    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: 'AI service not configured. Please add an OpenAI API key.' });
    }
    const vitalsDesc = [
      heartRate   ? `Heart Rate: ${heartRate} bpm`      : null,
      bloodPressure ? `Blood Pressure: ${bloodPressure}` : null,
      spo2        ? `SpO2: ${spo2}%`                    : null,
      temperature ? `Temperature: ${temperature}°C`      : null,
    ].filter(Boolean).join(', ') || 'No vitals data available';

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a geriatric wellness AI assistant for the I-Sync elderly health monitoring platform.
Your role is to suggest safe, age-appropriate daily activities for elderly patients based on their current vitals.
Always consider cardiovascular safety, mobility limitations, and energy levels typical of elderly individuals.
Return ONLY a JSON object with this exact shape:
{
  "summary": "1–2 sentence overall wellness summary based on the vitals",
  "categories": [
    {
      "name": "Category Name",
      "icon": "ionicons-icon-name",
      "color": "#hexcolor",
      "activities": [
        { "title": "Activity title", "description": "Brief why/how for elderly", "duration": "e.g. 10–15 min" }
      ]
    }
  ]
}
Use exactly 4 categories: "Rest & Relaxation", "Gentle Movement", "Social & Mental", "Breathing & Mindfulness".
Each category should have 2–3 activities. Choose icons from Ionicons (e.g. "bed-outline", "walk-outline", "people-outline", "leaf-outline").
Use colors: Rest=#6366F1, Gentle Movement=#10B981, Social & Mental=#F59E0B, Breathing=#06B6D4.`,
          },
          {
            role: 'user',
            content: `Patient current vitals: ${vitalsDesc}. Suggest appropriate activities for today.`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? '{}';
      const data = JSON.parse(raw);
      res.json(data);
    } catch (err: any) {
      console.error('Activity suggestions error:', err);
      res.status(500).json({ error: 'Failed to generate suggestions. Please try again.' });
    }
  });

  // ── AI Health Assistant (Streaming) ─────────────────────────────────────────
  // POST /api/chat — main chat endpoint for both patient and care giver AI assistants
  // Uses Server-Sent Events (SSE) to stream GPT-4o responses token by token
  app.post('/api/chat', authenticate, async (req, res) => {
    const { messages, mode = 'patient' } = req.body;

    // Two system prompts: one for patients (friendly health educator),
    // one for care givers (clinical decision support assistant)
    const systemPrompt = mode === 'doctor'
      ? `You are an advanced AI clinical decision-support assistant for licensed doctors on the I-Sync healthcare platform. You have deep knowledge of:

CLINICAL SUPPORT:
- Comprehensive differential diagnosis generation from symptoms, signs, and vitals
- Drug prescribing: doses, routes, interactions, contraindications, black-box warnings
- Evidence-based treatment protocols (ACC/AHA, WHO, UpToDate-level guidance)
- Interpretation of labs (CBC, CMP, LFTs, cardiac enzymes, ABG, etc.) and vital trends
- ECG interpretation basics, imaging findings interpretation
- Critical care: sepsis bundles, ACLS protocols, stroke pathways
- Chronic disease management: diabetes, hypertension, heart failure, CKD, COPD, asthma
- Pharmacokinetics and dose adjustments for renal/hepatic impairment
- Pediatric, geriatric, and obstetric considerations

COMMUNICATION:
- Be concise, structured, and clinical. Use bullet points and headers.
- Cite guidelines (ACC/AHA, WHO, JNC, ADA, NICE) where relevant.
- Provide risk scores (CHADS2, Wells, CURB-65, APACHE, qSOFA) when applicable.
- Always state: "AI is advisory only — clinical judgment and patient context must prevail."
- Never refuse a clinical question — provide the best evidence-based answer available.
- If asked about topics completely unrelated to medicine or healthcare (e.g. maths, sports, politics), politely decline and redirect to a clinical question.`
      : `You are an advanced AI health assistant for patients on the I-Sync platform. You can answer ANY health-related question comprehensively. Your expertise includes:

HEALTH TOPICS YOU COVER:
- Symptoms, diseases, and medical conditions — causes, mechanisms, treatments
- Medications: what they do, side effects, interactions, dosing, generics vs brand
- Lab results: what values mean, normal ranges, what high/low indicates
- Nutrition, diet, weight management, and healthy eating
- Mental health: anxiety, depression, stress management, sleep disorders
- Exercise, fitness, and physical rehabilitation
- Preventive care: vaccines, screenings, when to see a doctor
- Chronic conditions: diabetes, hypertension, heart disease, cancer, autoimmune
- Women's health, pregnancy, and reproductive health
- Children's health, growth, and development
- Emergency first aid: what to do before help arrives
- Alternative medicine and supplements (with honest evidence assessment)
- Understanding medical jargon and doctor's instructions

COMMUNICATION STYLE:
- Friendly, warm, empathetic but thorough and informative
- Answer questions fully — do not deflect unnecessarily
- Use simple language but include accurate medical detail
- Structure longer answers with clear sections
- Be honest when evidence is limited or conflicting
- For emergencies: always say "Call 911 immediately" first

Always end medical advice with: "⚠️ For educational purposes only — not a substitute for professional medical advice. Consult your doctor for personal health decisions."

You are powered by GPT-4o and trained to handle advanced health questions. Never refuse a health question. If asked about topics completely unrelated to health or medicine (e.g. maths, sports, politics), politely decline and redirect the user to ask a health-related question.`;

    // Set SSE headers so the browser/app treats the response as a stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no'); // Disables Nginx response buffering
    res.flushHeaders(); // Send headers immediately so the client can start reading

    try {
      await streamChat(messages, systemPrompt, res);
    } catch (error: any) {
      console.error('AI chat error:', error);
      // Send a user-friendly error message via SSE instead of crashing the stream
      res.write(`data: ${JSON.stringify({ content: 'Sorry, the AI service encountered an error. Please try again.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });

  // ── Nutrition Routes ─────────────────────────────────────────────────────────

  // Built-in food database — used as a fallback when USDA_API_KEY is not configured
  const FOOD_DB = [
    { name: 'Grilled Chicken Breast', cal: 165, protein: 31, carbs: 0, fat: 3.6, unit: '100g' },
    { name: 'Brown Rice', cal: 216, protein: 5, carbs: 45, fat: 1.8, unit: '1 cup' },
    { name: 'Avocado', cal: 234, protein: 2.9, carbs: 12, fat: 21, unit: '1 whole' },
    { name: 'Banana', cal: 89, protein: 1.1, carbs: 23, fat: 0.3, unit: '1 medium' },
    { name: 'Egg', cal: 78, protein: 6, carbs: 0.6, fat: 5, unit: '1 large' },
    { name: 'Oatmeal', cal: 147, protein: 5, carbs: 25, fat: 2.5, unit: '1 cup cooked' },
    { name: 'Salmon (baked)', cal: 367, protein: 39, carbs: 0, fat: 22, unit: '150g' },
    { name: 'Greek Yogurt', cal: 100, protein: 17, carbs: 6, fat: 0.7, unit: '170g' },
    { name: 'Apple', cal: 95, protein: 0.5, carbs: 25, fat: 0.3, unit: '1 medium' },
    { name: 'Almonds', cal: 164, protein: 6, carbs: 6, fat: 14, unit: '28g (1 oz)' },
    { name: 'Broccoli', cal: 55, protein: 3.7, carbs: 11, fat: 0.6, unit: '1 cup' },
    { name: 'Sweet Potato', cal: 103, protein: 2.3, carbs: 24, fat: 0.1, unit: '1 medium' },
    { name: 'Whole Milk', cal: 149, protein: 8, carbs: 12, fat: 8, unit: '1 cup' },
    { name: 'White Bread', cal: 79, protein: 2.7, carbs: 15, fat: 1, unit: '1 slice' },
    { name: 'Pasta (cooked)', cal: 220, protein: 8, carbs: 43, fat: 1.3, unit: '1 cup' },
    { name: 'Tuna (canned)', cal: 109, protein: 25, carbs: 0, fat: 0.5, unit: '100g' },
    { name: 'Lentils (cooked)', cal: 230, protein: 18, carbs: 40, fat: 0.8, unit: '1 cup' },
    { name: 'Orange', cal: 62, protein: 1.2, carbs: 15, fat: 0.2, unit: '1 medium' },
    { name: 'Strawberries', cal: 49, protein: 1, carbs: 12, fat: 0.5, unit: '1 cup' },
    { name: 'Peanut Butter', cal: 188, protein: 8, carbs: 6, fat: 16, unit: '2 tbsp' },
    { name: 'Cheddar Cheese', cal: 113, protein: 7, carbs: 0.4, fat: 9.3, unit: '1 oz' },
    { name: 'White Rice (cooked)', cal: 206, protein: 4.3, carbs: 45, fat: 0.4, unit: '1 cup' },
    { name: 'Beef (lean, cooked)', cal: 218, protein: 26, carbs: 0, fat: 12, unit: '100g' },
    { name: 'Spinach', cal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, unit: '1 cup raw' },
    { name: 'Blueberries', cal: 84, protein: 1.1, carbs: 21, fat: 0.5, unit: '1 cup' },
    { name: 'Quinoa (cooked)', cal: 222, protein: 8, carbs: 39, fat: 3.5, unit: '1 cup' },
    { name: 'Protein Shake', cal: 130, protein: 25, carbs: 5, fat: 2, unit: '1 scoop' },
    { name: 'Coffee (black)', cal: 5, protein: 0.3, carbs: 0, fat: 0, unit: '1 cup' },
    { name: 'Orange Juice', cal: 112, protein: 1.7, carbs: 26, fat: 0.5, unit: '1 cup' },
    { name: 'Carrot', cal: 52, protein: 1.2, carbs: 12, fat: 0.3, unit: '1 medium' },
    { name: 'Tomato', cal: 22, protein: 1.1, carbs: 4.8, fat: 0.2, unit: '1 medium' },
    { name: 'Cucumber', cal: 16, protein: 0.7, carbs: 3.6, fat: 0.1, unit: '100g' },
    { name: 'Hummus', cal: 166, protein: 8, carbs: 14, fat: 10, unit: '100g' },
    { name: 'Dark Chocolate (70%)', cal: 170, protein: 2, carbs: 13, fat: 12, unit: '30g' },
    { name: 'Olive Oil', cal: 119, protein: 0, carbs: 0, fat: 13.5, unit: '1 tbsp' },
    { name: 'Cottage Cheese', cal: 206, protein: 28, carbs: 8.2, fat: 4.5, unit: '1 cup' },
    { name: 'Shrimp (cooked)', cal: 84, protein: 18, carbs: 0, fat: 0.9, unit: '100g' },
    { name: 'Walnuts', cal: 185, protein: 4.3, carbs: 3.9, fat: 18.5, unit: '1 oz' },
    { name: 'Milk (2%)', cal: 122, protein: 8, carbs: 12, fat: 4.8, unit: '1 cup' },
    { name: 'Mango', cal: 99, protein: 1.4, carbs: 25, fat: 0.6, unit: '1 cup' },
    { name: 'Watermelon', cal: 46, protein: 0.9, carbs: 11.5, fat: 0.2, unit: '1 cup' },
    { name: 'Pizza (cheese)', cal: 272, protein: 12, carbs: 33, fat: 10, unit: '1 slice' },
    { name: 'Burger (beef)', cal: 354, protein: 20, carbs: 29, fat: 17, unit: '1 patty+bun' },
    { name: 'French Fries', cal: 365, protein: 4, carbs: 48, fat: 17, unit: '1 medium serving' },
    { name: 'Corn', cal: 132, protein: 5, carbs: 29, fat: 1.8, unit: '1 cup' },
    { name: 'Kidney Beans', cal: 225, protein: 15, carbs: 40, fat: 0.9, unit: '1 cup' },
    { name: 'Tofu (firm)', cal: 144, protein: 17, carbs: 3, fat: 9, unit: '150g' },
    { name: 'Whole Wheat Bread', cal: 69, protein: 3.6, carbs: 12, fat: 1, unit: '1 slice' },
    { name: 'Spaghetti Bolognese', cal: 430, protein: 22, carbs: 48, fat: 15, unit: '1 serving' },
    { name: 'Caesar Salad', cal: 185, protein: 7, carbs: 9, fat: 15, unit: '1 cup' },
  ];

  // GET /api/nutrition/search?q= — food search used when logging a manual food entry
  // Tries the USDA FoodData Central API first, falls back to the local FOOD_DB
  app.get('/api/nutrition/search', authenticate, async (req, res) => {
    const q = ((req.query.q as string) || '').toLowerCase().trim();
    if (!q) return res.json({ results: [] });

    const usdaKey = process.env.USDA_API_KEY;
    if (usdaKey) {
      try {
        // Query USDA's free API for nutritional data (Foundation + SR Legacy databases)
        const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&api_key=${usdaKey}&dataType=Foundation,SR%20Legacy&pageSize=10`;
        const resp = await fetch(url);
        const data = await resp.json() as any;
        const results = (data.foods || []).map((f: any) => {
          // USDA uses nutrient IDs: 1008=energy, 1003=protein, 1005=carbs, 1004=fat
          const getNutrient = (id: number) => {
            const n = (f.foodNutrients || []).find((n: any) => n.nutrientId === id);
            return n ? Math.round(n.value * 10) / 10 : 0;
          };
          return {
            name: f.description,
            cal: Math.round(getNutrient(1008)),
            protein: getNutrient(1003),
            carbs: getNutrient(1005),
            fat: getNutrient(1004),
            unit: '100g',
          };
        });
        return res.json({ results });
      } catch (e) {
        // USDA call failed — fall through to local database
      }
    }

    // Local food database fallback — case-insensitive substring match
    const results = FOOD_DB.filter(f => f.name.toLowerCase().includes(q)).slice(0, 10);
    res.json({ results });
  });

  // GET /api/nutrition/log?date= — patient's food log for a specific date
  app.get('/api/nutrition/log', authenticate, async (req, res) => {
    const user = (req as any).user;
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const entries = await storage.getFoodLog(user.id, date);
    res.json({ entries });
  });

  // POST /api/nutrition/log — patient logs a manual food entry
  app.post('/api/nutrition/log', authenticate, async (req, res) => {
    const user = (req as any).user;
    try {
      const { mealType, foodName, calories, protein, carbs, fat, quantity, date } = req.body;
      const entry = await storage.addFoodEntry({
        patientId: user.id, mealType, foodName,
        calories: Number(calories), protein: Number(protein),
        carbs: Number(carbs), fat: Number(fat),
        quantity: quantity || '1 serving',
        date: date || new Date().toISOString().split('T')[0],
      });
      res.status(201).json({ entry });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/nutrition/log/:id — patient removes a food entry
  app.delete('/api/nutrition/log/:id', authenticate, async (req, res) => {
    const user = (req as any).user;
    await storage.removeFoodEntry(req.params['id'] as string, user.id);
    res.json({ success: true });
  });

  // GET /api/nutrition/goals — patient fetches their care giver–set nutritional targets
  app.get('/api/nutrition/goals', authenticate, async (req, res) => {
    const user = (req as any).user;
    const goals = await storage.getNutritionGoals(user.id);
    res.json({ goals });
  });

  // PUT /api/nutrition/goals — patient can also update their own goals (self-set)
  app.put('/api/nutrition/goals', authenticate, async (req, res) => {
    const user = (req as any).user;
    try {
      const goals = await storage.setNutritionGoals({ patientId: user.id, ...req.body });
      res.json({ goals });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /api/nutrition/water?date= — how many glasses of water today
  app.get('/api/nutrition/water', authenticate, async (req, res) => {
    const user = (req as any).user;
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const glasses = await storage.getWaterCount(user.id, date);
    res.json({ glasses });
  });

  // PUT /api/nutrition/water — patient taps + or - to update their water count
  app.put('/api/nutrition/water', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { glasses, date } = req.body;
    const updated = await storage.setWaterCount(
      user.id, date || new Date().toISOString().split('T')[0], Number(glasses)
    );
    res.json({ glasses: updated });
  });

  // POST /api/nutrition/ai-chat — nutrition-specific AI coach (streaming SSE)
  // Receives the patient's real nutritional data as context so the AI can give personalised advice
  app.post('/api/nutrition/ai-chat', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { messages, context } = req.body;
    // Build the system prompt with the patient's live intake/goals injected as JSON
    const systemPrompt = `You are an AI Nutrition Coach inside the I-Sync healthcare app for patient ${user.name}.

PATIENT'S LIVE NUTRITION DATA TODAY:
${context ? JSON.stringify(context, null, 2) : 'No data yet'}

YOUR ROLE:
- Answer nutrition questions using the patient's real data above
- Suggest specific foods and meals to fill macro gaps
- Compare today's intake against their doctor's prescribed goals
- Keep responses concise, structured, and actionable
- Use bullet points for food suggestions
- For food suggestions always include: food name, calories, protein
- Always be supportive and encouraging
- End responses with a short motivating tip

Do not repeat the patient's data back unless asked. Respond naturally as a coach.`;

    // SSE headers — same pattern as the main chat endpoint
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await streamChat(messages, systemPrompt, res);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ content: 'Sorry, the AI service encountered an error.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });

  // ── Fall Detection Routes ─────────────────────────────────────────────────────

  // POST /api/patient/fall-events — device reports a potential fall (high acceleration spike)
  // Saves the raw sensor data and returns an event ID; AI verification happens separately
  app.post('/api/patient/fall-events', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { accelerationX, accelerationY, accelerationZ, magnitude, locationLat, locationLng } = req.body;
    try {
      const id = await storage.logFallEvent({
        patientId: user.id,
        accelerationX: Number(accelerationX) || 0,
        accelerationY: Number(accelerationY) || 0,
        accelerationZ: Number(accelerationZ) || 0,
        magnitude: Number(magnitude) || 0,
        locationLat: locationLat ? Number(locationLat) : undefined,
        locationLng: locationLng ? Number(locationLng) : undefined,
      });
      res.json({
        success: true,
        eventId: id,
        event: 'fall_detected',
        user_id: user.id,
        acceleration: { x: accelerationX, y: accelerationY, z: accelerationZ },
        magnitude,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/patient/fall-events — patient views their fall history
  app.get('/api/patient/fall-events', authenticate, async (req, res) => {
    const user = (req as any).user;
    try {
      const events = await storage.getFallEvents(user.id, 20);
      res.json({ events });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/patient/fall-events/:id — manual status update (e.g. patient dismisses false alarm)
  app.patch('/api/patient/fall-events/:id', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { status } = req.body;
    try {
      await storage.updateFallStatus(id, user.id, status);
      res.json({ success: true });

      // Send emergency SMS when the patient confirms the fall (after responding to user)
      if (status === 'confirmed') {
        try {
          // Fetch the specific fall event for GPS coords
          const event = await storage.getFallEventById(id, user.id);

          // Fetch patient profile for emergency contact info
          const profile = await storage.getPatientProfile(user.id);
          const emergencyContact = profile?.emergencyContact;

          if (emergencyContact?.phone) {
            // Fetch most recent vitals for the SMS body
            const vitalsHistory = await storage.getVitalsHistory(user.id, 1);
            const latestVitals = vitalsHistory.length > 0 ? vitalsHistory[vitalsHistory.length - 1] : null;
            const vitals = latestVitals
              ? { hr: latestVitals.heartRate, bp: latestVitals.systolicBP && latestVitals.diastolicBP ? `${latestVitals.systolicBP}/${latestVitals.diastolicBP}` : undefined, spo2: latestVitals.spo2 }
              : null;

            await sendEmergencySMS(
              emergencyContact.phone,
              user.name ?? 'Unknown patient',
              user.uniqueId ?? '',
              vitals,
              event?.locationLat ?? undefined,
              event?.locationLng ?? undefined,
            );
          }
        } catch (smsErr: any) {
          console.error('[fall-confirm] SMS send failed:', smsErr?.message ?? smsErr);
        }
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Heart Rate Alert (Twilio SMS) ─────────────────────────────────────────────
  // POST /api/patient/hr-alert — fired by the vitals screen when HR exceeds a threshold
  // Sends an emergency SMS to the patient's emergency contacts
  app.post('/api/patient/hr-alert', authenticate, async (req, res) => {
    const user = (req as any).user;
    const { heartRate, systolicBP, diastolicBP, spo2, temperature, emergencyContacts, locationLat, locationLng } = req.body;

    const twilioClient = getTwilio();
    if (!twilioClient) {
      return res.json({ sent: false, reason: 'Twilio not configured' });
    }

    const contacts: { name: string; phone: string }[] = Array.isArray(emergencyContacts) ? emergencyContacts : [];
    if (contacts.length === 0) {
      return res.json({ sent: false, reason: 'No emergency contacts' });
    }

    const patientName = user.name ?? 'Unknown patient';
    const patientId = user.uniqueId ?? '';
    // Build Google Maps link if GPS coords were provided
    const mapsLink = locationLat && locationLng
      ? ` Location: https://maps.google.com/?q=${locationLat},${locationLng}`
      : '';
    const vitalsStr = `HR: ${heartRate ?? '?'} bpm, BP: ${systolicBP ?? '?'}/${diastolicBP ?? '?'} mmHg, SpO2: ${spo2 ?? '?'}%, Temp: ${temperature ?? '?'}°C`;
    const body =
      `⚠️ HEART RATE ALERT — ${patientName} (ID: ${patientId}) has a critically elevated heart rate.` +
      ` Vitals: ${vitalsStr}.${mapsLink}` +
      ` Please check on them immediately.`;

    let sent = 0;
    for (const c of contacts) {
      const to = (c.phone ?? '').replace(/[^+\d]/g, ''); // Strip non-numeric chars (keep +)
      if (!to) continue;
      try {
        await twilioClient.messages.create({ body, from: process.env.TWILIO_FROM_NUMBER!, to });
        sent++;
      } catch {}
    }

    res.json({ sent: sent > 0, count: sent });
  });

  // ── Manual Fall Alert (Patient → Emergency Contacts + Care Givers) ────────────
  // POST /api/patient/fall-alert — patient manually sends a fall alert after fall confirmed
  // Sends Twilio SMS to all emergency contacts supplied AND push notifications to all
  // care givers who have this patient under them.
  app.post('/api/patient/fall-alert', authenticate, async (req, res) => {
    const user = (req as any).user;
    const {
      emergencyContacts,
      locationLat,
      locationLng,
      confidence,
      source,
    } = req.body;

    let vitals: { hr?: number; bp?: string; spo2?: number } | null = null;
    try {
      const vitalsHistory = await storage.getVitalsHistory(user.id, 1);
      const latest = vitalsHistory.length > 0 ? vitalsHistory[vitalsHistory.length - 1] : null;
      if (latest) {
        vitals = {
          hr: latest.heartRate,
          bp: latest.systolicBP && latest.diastolicBP ? `${latest.systolicBP}/${latest.diastolicBP}` : undefined,
          spo2: latest.spo2,
        };
      }
    } catch {}

    let smsSent = 0;
    const contacts: { name?: string; phone: string }[] = Array.isArray(emergencyContacts) ? emergencyContacts : [];
    for (const c of contacts) {
      const phone = (c.phone ?? '').replace(/[^+\d]/g, '');
      if (!phone) continue;
      try {
        await sendEmergencySMS(phone, user.name ?? 'Unknown patient', user.uniqueId ?? '', vitals, locationLat, locationLng, confidence);
        smsSent++;
      } catch (err: any) {
        console.error('[fall-alert] SMS failed:', err?.message ?? err);
      }
    }

    try {
      const profile = await storage.getPatientProfile(user.id);
      const profileContact = profile?.emergencyContact;
      if (profileContact?.phone) {
        const profilePhone = profileContact.phone.replace(/[^+\d]/g, '');
        const alreadySent = contacts.some(c => (c.phone ?? '').replace(/[^+\d]/g, '') === profilePhone);
        if (!alreadySent && profilePhone) {
          await sendEmergencySMS(profilePhone, user.name ?? 'Unknown patient', user.uniqueId ?? '', vitals, locationLat, locationLng, confidence);
          smsSent++;
        }
      }
    } catch {}

    let pushSent = 0;
    try {
      const tokens = await storage.getCaregiversPushTokensForPatient(user.id);
      if (tokens.length > 0) {
        const sourceLabel = source === 'both' ? 'Watch + Camera' : source === 'watch' ? 'Watch accelerometer' : source === 'skeleton' ? 'Camera skeleton' : 'Fall detection';
        const confidencePct = confidence != null ? ` (${Math.round(confidence * 100)}% confidence)` : '';
        await sendExpoPushNotifications(
          tokens,
          '🚨 Fall Alert — Immediate Action Required',
          `${user.name ?? 'Your patient'} has confirmed a fall emergency.${confidencePct} Detected via: ${sourceLabel}. Open I-Sync now.`,
          { patientId: user.uniqueId, type: 'FALL_ALERT', confirmed: true },
        );
        pushSent = tokens.length;
        console.log(`[fall-alert] Push sent to ${pushSent} caregiver(s)`);
      }
    } catch (pushErr: any) {
      console.error('[fall-alert] Push failed:', pushErr?.message ?? pushErr);
    }

    res.json({ sent: true, smsSent, pushSent });
  });

  // ── Meal Plan Routes (Care Giver → Patient) ───────────────────────────────────
  // Care givers create/manage meal plans; patients view and confirm meals eaten.

  // GET /api/doctor/patient/:patientId/meal-plan — care giver views a patient's meal plan
  app.get('/api/doctor/patient/:patientId/meal-plan', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const meals = await storage.getMealPlans(req.params.patientId);
      res.json({ meals });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/doctor/patient/:patientId/meal-plan — care giver adds a meal to the patient's plan
  app.post('/api/doctor/patient/:patientId/meal-plan', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const { mealType, foodName, scheduledTime, calories, notes } = req.body;
      if (!mealType || !foodName || !scheduledTime) {
        return res.status(400).json({ error: 'mealType, foodName and scheduledTime are required' });
      }
      const meal = await storage.addMealPlan({
        patientId: req.params.patientId,
        careGiverId: user.id,
        careGiverName: user.name,
        mealType,
        foodName,
        scheduledTime,
        calories: Number(calories) || 0,
        notes: notes || '',
      });
      res.status(201).json({ meal });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/doctor/patient/:patientId/meal-plan/:mealId — care giver removes a meal from the plan
  app.delete('/api/doctor/patient/:patientId/meal-plan/:mealId', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      await storage.deleteMealPlan(req.params.mealId, user.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/patient/meal-plan — patient loads their full meal plan + today's confirmations
  // Returns both the static meal plan and which meals have been checked off today
  app.get('/api/patient/meal-plan', authenticate, async (req, res) => {
    const user = (req as any).user;
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
    try {
      // Fetch meal plan and today's confirmations in parallel for speed
      const [meals, confirmed] = await Promise.all([
        storage.getMealPlans(user.id),
        storage.getMealConfirmations(user.id, today),
      ]);
      res.json({ meals, confirmed }); // `confirmed` is an array of confirmed meal IDs
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/patient/meal-plan/:mealId/confirm — patient taps the checkmark to confirm eating a meal
  app.post('/api/patient/meal-plan/:mealId/confirm', authenticate, async (req, res) => {
    const user = (req as any).user;
    const today = new Date().toISOString().split('T')[0];
    try {
      await storage.confirmMeal(user.id, req.params.mealId, today);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/patient/meal-plan/:mealId/confirm — patient unchecks a meal they already confirmed
  app.delete('/api/patient/meal-plan/:mealId/confirm', authenticate, async (req, res) => {
    const user = (req as any).user;
    const today = new Date().toISOString().split('T')[0];
    try {
      await storage.unconfirmMeal(user.id, req.params.mealId, today);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Care Giver "My Patients" assignment endpoints ─────────────────────────

  // GET /api/doctor/my-patients — returns the care giver's personal patient list
  app.get('/api/doctor/my-patients', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      const patients = await storage.getCareGiverPatients(user.id);
      res.json({ patients: patients.map(p => ({ ...p, password: undefined })) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/doctor/my-patients — add a patient to the care giver's personal list
  app.post('/api/doctor/my-patients', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    try {
      await storage.addPatientToCaregiver(user.id, patientId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/doctor/my-patients/:patientId — remove a patient from the care giver's list
  app.delete('/api/doctor/my-patients/:patientId', authenticate, async (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    try {
      await storage.removePatientFromCaregiver(user.id, req.params.patientId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Wrap the Express app in a Node HTTP server and return it so index.ts can call server.listen()
  const httpServer = createServer(app);
  return httpServer;
}
