// ─────────────────────────────────────────────────────────────────────────────
// server/storage.ts  —  Database access layer (all SQL queries live here)
// This file is the only place in the backend that talks to PostgreSQL.
// Routes call these functions; they never write SQL directly.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';

// ── Database Connection Pool ──────────────────────────────────────────────────
// A "pool" keeps multiple open connections to PostgreSQL so requests don't
// have to wait for a connection to be established every time.
// We use lazy initialisation: the pool is created the first time it's needed.
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    const dbUrl = process.env.DATABASE_URL || '';
    // Detect whether we are talking to a local DB or a cloud DB
    const isLocal = !dbUrl || dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
    _pool = new Pool({
      connectionString: dbUrl,
      // Cloud databases require SSL; local ones do not
      ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
      connectionTimeoutMillis: 10000, // Fail fast if DB is unreachable
      idleTimeoutMillis: 30000,       // Release idle connections after 30s
    });
    // Log unexpected errors so the server doesn't crash silently
    _pool.on('error', (err) => {
      console.error('Unexpected DB pool error:', err.message);
    });
  }
  return _pool;
}

// Proxy wrapper so we can call pool.query() etc. without importing getPool everywhere.
// Every property access on `pool` transparently goes through getPool().
const pool = new Proxy({} as Pool, {
  get(_t, prop) {
    const p = getPool();
    const val = (p as any)[prop as string];
    // Bind methods so `this` inside them still refers to the real Pool instance
    return typeof val === 'function' ? val.bind(p) : val;
  },
});

// ── TypeScript Type Definitions ───────────────────────────────────────────────
// These mirror the database table columns so TypeScript can catch type mismatches.

export type UserRole = 'patient' | 'doctor';

// Represents a row in the `users` table
export type User = {
  id: string;          // Internal UUID hex (16 random chars)
  role: UserRole;      // 'patient' or 'doctor' (care giver)
  uniqueId: string;    // Human-readable ID shown on screen: PAT-XXXXXXX or CGR-XXXXXXX
  name: string;
  email: string;
  password: string;    // Sanitised to '[hidden]' before sending to clients
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  createdAt: Date;
};

// Medical profile linked to a patient user (one-to-one with users table)
export type PatientProfile = {
  userId: string;
  weight?: number;
  height?: number;
  bloodType?: string;
  allergies: string[];    // Array stored as PostgreSQL text array
  conditions: string[];   // Array stored as PostgreSQL text array
  emergencyContact?: { name: string; phone: string; relation: string };
  notes?: string;
};

// A single set of vital signs recorded by the patient's device
export type VitalsRecord = {
  id: string;
  patientId: string;
  heartRate: number;      // Beats per minute
  systolicBP: number;     // mmHg (top number of blood pressure)
  diastolicBP: number;    // mmHg (bottom number of blood pressure)
  spo2: number;           // Blood oxygen saturation (%)
  temperature: number;    // Body temperature in Celsius
  timestamp: Date;
};

// A record of a change made by a care giver to a patient's profile (audit trail)
export type ActivityLogEntry = {
  id: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  field: string;          // Which field was changed (e.g. "weight", "allergies")
  previousValue: string;  // JSON-stringified old value
  newValue: string;       // JSON-stringified new value
  timestamp: Date;
};

// An appointment between a patient and a care giver
export type Appointment = {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  date: string;           // ISO date string "YYYY-MM-DD"
  time: string;           // "HH:MM" format
  specialty: string;
  notes: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: Date;
};

// A medication prescription issued by a care giver
export type Prescription = {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  medicationName: string;
  dosage: string;         // e.g. "500mg"
  frequency: string;      // e.g. "Twice daily"
  times: string[];        // Reminder times e.g. ["08:00", "20:00"]
  notes: string;
  prescribedAt: Date;
};

// A single food item logged by a patient (now legacy — meal plans replace this)
export type FoodEntry = {
  id: string;
  patientId: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantity: string;
  date: string;
  loggedAt: Date;
};

// Macro/calorie goals set by the care giver for a patient
export type NutritionGoals = {
  patientId: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  water: number;          // Target number of glasses per day
  doctorNote?: string;    // Free-text note from care giver shown to patient
};

// ── Authentication Token Store ─────────────────────────────────────────────────
// Tokens are kept in-memory (Map) for simplicity.
// If the server restarts, tokens are lost and users must log in again.
// The user accounts themselves are safe in PostgreSQL.
const authTokensMap = new Map<string, string>(); // token → userId

// ── ID / Password Helpers ─────────────────────────────────────────────────────

// Generates a random 8-byte hex string used as an internal database ID
function generateId(): string {
  return randomBytes(8).toString('hex');
}

// SHA-256 hash of the password + a fixed salt. Not bcrypt but prevents plain-text storage.
function hashPassword(password: string): string {
  return createHash('sha256').update(password + 'isync_secure_salt_v1').digest('hex');
}

// Generates a patient unique ID like PAT-X7KJ2MN
function generateUMIN(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 7; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return `PAT-${result}`;
}

// Generates a care giver unique ID like CGR-A3ZT9QR
function generateDOCID(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 7; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return `CGR-${result}`;
}

// ── Row Mappers ───────────────────────────────────────────────────────────────
// PostgreSQL returns rows with snake_case column names.
// These functions convert them into camelCase TypeScript objects.

function rowToUser(row: any): User {
  return {
    id: row.id,
    role: row.role,
    uniqueId: row.unique_id,      // snake_case → camelCase
    name: row.name,
    email: row.email,
    password: row.password_hash,  // Column is named password_hash in DB
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    createdAt: row.created_at,
  };
}

// Remove the password hash before sending user objects to the client
function sanitizeUser(user: User): User {
  return { ...user, password: '[hidden]' };
}

function rowToProfile(row: any): PatientProfile {
  return {
    userId: row.patient_id,
    allergies: row.allergies || [],
    conditions: row.conditions || [],
    bloodType: row.blood_type,
    // DECIMAL columns come back as strings from pg — convert to number
    weight: row.weight ? Number(row.weight) : undefined,
    height: row.height ? Number(row.height) : undefined,
    notes: row.notes,
    emergencyContact: row.emergency_contact,
  };
}

function rowToVitals(row: any): VitalsRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    heartRate: row.heart_rate,
    systolicBP: row.systolic_bp,
    diastolicBP: row.diastolic_bp,
    spo2: Number(row.spo2),             // DECIMAL → number
    temperature: Number(row.temperature), // DECIMAL → number
    timestamp: row.recorded_at,
  };
}

function rowToAppointment(row: any): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    date: row.date,
    time: row.time,
    specialty: row.specialty || '',
    notes: row.notes || '',
    status: row.status,
    createdAt: row.created_at,
  };
}

function rowToPrescription(row: any): Prescription {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    medicationName: row.medication_name,
    dosage: row.dosage,
    frequency: row.frequency,
    times: row.times || [],    // Stored as a PostgreSQL array
    notes: row.notes || '',
    prescribedAt: row.prescribed_at,
  };
}

// ── Main Storage Object ───────────────────────────────────────────────────────
// All database functions are methods on this exported object.
// Routes import `storage` and call e.g. storage.loginUser(email, password).
export const storage = {

  // ── User Registration ───────────────────────────────────────────────────────
  // Creates a new user row, auto-generates a unique display ID,
  // and creates an empty patient_profiles row for patient accounts.
  async registerUser(data: {
    role: UserRole;
    name: string;
    email: string;
    password: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: string;
  }): Promise<User> {
    const id = generateId();
    // Patient gets PAT-XXXXXXX, care giver gets CGR-XXXXXXX
    const uniqueId = data.role === 'patient' ? generateUMIN() : generateDOCID();
    const passwordHash = hashPassword(data.password);

    try {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, name, role, unique_id, phone, gender, date_of_birth)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, data.email.toLowerCase(), passwordHash, data.name, data.role, uniqueId,
         data.phone || null, data.gender || null, data.dateOfBirth || null]
      );
    } catch (err: any) {
      // PostgreSQL error code 23505 = unique constraint violation (email already used)
      if (err.code === '23505') throw new Error('Email already registered');
      throw err;
    }

    // Automatically create an empty medical profile for every new patient
    if (data.role === 'patient') {
      await pool.query(
        `INSERT INTO patient_profiles (patient_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [id]
      );
    }

    // Re-fetch and return the created user (sanitised, no password)
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return sanitizeUser(rowToUser(res.rows[0]));
  },

  // ── Login ───────────────────────────────────────────────────────────────────
  // Verifies email + password, creates an in-memory session token, and returns it.
  // The token is sent to the client and must be included in subsequent requests.
  async loginUser(email: string, password: string): Promise<{ user: User; token: string }> {
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (res.rows.length === 0) throw new Error('Invalid email or password');
    const user = rowToUser(res.rows[0]);
    // Compare hashed passwords — never compare plain text
    if (user.password !== hashPassword(password)) throw new Error('Invalid email or password');
    // Generate a 32-byte (64 hex chars) random session token
    const token = randomBytes(32).toString('hex');
    authTokensMap.set(token, user.id); // Store token → userId mapping
    return { user: sanitizeUser(user), token };
  },

  // ── Token Lookup ────────────────────────────────────────────────────────────
  // Called by the authenticate middleware on every protected request.
  // Looks up the token in memory, then fetches the full user from DB.
  async getUserByToken(token: string): Promise<User | null> {
    const userId = authTokensMap.get(token);
    if (!userId) return null; // Token not found → not logged in
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (res.rows.length === 0) return null;
    return sanitizeUser(rowToUser(res.rows[0]));
  },

  // ── Look up user by their human-readable unique ID (PAT-XXXXXXX / CGR-XXXXXXX)
  async getUserByUniqueId(uniqueId: string): Promise<User | null> {
    const res = await pool.query('SELECT * FROM users WHERE unique_id = $1', [uniqueId]);
    if (res.rows.length === 0) return null;
    return sanitizeUser(rowToUser(res.rows[0]));
  },

  // ── Logout ──────────────────────────────────────────────────────────────────
  // Removes the token from memory so it can no longer be used
  async logoutUser(token: string): Promise<void> {
    authTokensMap.delete(token);
  },

  // ── Patient Profile ─────────────────────────────────────────────────────────
  // Fetches the medical profile (allergies, conditions, blood type, etc.)
  async getPatientProfile(userId: string): Promise<PatientProfile | null> {
    const res = await pool.query('SELECT * FROM patient_profiles WHERE patient_id = $1', [userId]);
    if (res.rows.length === 0) return null;
    return rowToProfile(res.rows[0]);
  },

  // Updates specific fields on the patient's profile.
  // When a care giver makes the update (doctorId/doctorName provided),
  // every changed field is logged to the activity_log table.
  async updatePatientProfile(
    userId: string,
    updates: Partial<Omit<PatientProfile, 'userId'>>,
    doctorId?: string,
    doctorName?: string
  ): Promise<PatientProfile> {
    const existing = await this.getPatientProfile(userId);
    if (!existing) throw new Error('Patient profile not found');

    // Only log changes when a care giver is making the update
    if (doctorId && doctorName) {
      for (const [key, newVal] of Object.entries(updates)) {
        const prevVal = (existing as Record<string, unknown>)[key];
        const prev = JSON.stringify(prevVal ?? null);
        const next = JSON.stringify(newVal);
        // Only log if the value actually changed
        if (prev !== next) {
          await pool.query(
            `INSERT INTO activity_log (patient_id, field, previous_value, new_value, doctor_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, key, prev, next, doctorName]
          );
        }
      }
    }

    // Merge existing data with the updates, then upsert the whole row
    const merged = { ...existing, ...updates };
    await pool.query(
      `INSERT INTO patient_profiles (patient_id, allergies, conditions, blood_type, weight, height, notes, emergency_contact, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (patient_id) DO UPDATE SET
         allergies = $2, conditions = $3, blood_type = $4,
         weight = $5, height = $6, notes = $7, emergency_contact = $8, updated_at = NOW()`,
      [userId, merged.allergies, merged.conditions, merged.bloodType || null,
       merged.weight || null, merged.height || null, merged.notes || null,
       merged.emergencyContact ? JSON.stringify(merged.emergencyContact) : null]
    );

    return merged;
  },

  // ── Vitals ──────────────────────────────────────────────────────────────────
  // Saves a new vitals reading from the patient's device.
  // Automatically trims the history to the most recent 200 records per patient.
  async addVitalsRecord(
    patientId: string,
    vitals: Omit<VitalsRecord, 'id' | 'patientId' | 'timestamp'>
  ): Promise<VitalsRecord> {
    const id = generateId();
    const res = await pool.query(
      `INSERT INTO vitals (id, patient_id, heart_rate, systolic_bp, diastolic_bp, spo2, temperature)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, patientId, vitals.heartRate, vitals.systolicBP, vitals.diastolicBP, vitals.spo2, vitals.temperature]
    );
    // Prune old records to prevent unbounded growth — keep only the 200 newest
    await pool.query(
      `DELETE FROM vitals WHERE patient_id = $1 AND id NOT IN (
         SELECT id FROM vitals WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 200
       )`,
      [patientId]
    );
    return rowToVitals(res.rows[0]);
  },

  // Returns vitals history in chronological order (oldest first) for charting
  async getVitalsHistory(patientId: string, limit = 24): Promise<VitalsRecord[]> {
    const res = await pool.query(
      `SELECT * FROM vitals WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT $2`,
      [patientId, limit]
    );
    // DESC gives newest first → reverse so the array is chronological for charts
    return res.rows.map(rowToVitals).reverse();
  },

  // ── Patient Search ──────────────────────────────────────────────────────────
  // Used by care givers to find patients by name or unique ID (PAT-XXXXXXX)
  async searchPatients(query: string): Promise<User[]> {
    const q = `%${query.toLowerCase()}%`;
    const res = await pool.query(
      `SELECT * FROM users WHERE role = 'patient' AND (LOWER(name) LIKE $1 OR LOWER(unique_id) LIKE $1)
       ORDER BY name LIMIT 50`,
      [q]
    );
    return res.rows.map(r => sanitizeUser(rowToUser(r)));
  },

  // Looks up a single patient by their internal database ID
  async getPatientById(userId: string): Promise<User | null> {
    const res = await pool.query(`SELECT * FROM users WHERE id = $1 AND role = 'patient'`, [userId]);
    if (res.rows.length === 0) return null;
    return sanitizeUser(rowToUser(res.rows[0]));
  },

  // ── Activity Log ────────────────────────────────────────────────────────────
  // Returns the audit trail of care giver changes for a patient (newest first)
  async getActivityLog(patientId: string): Promise<ActivityLogEntry[]> {
    const res = await pool.query(
      `SELECT * FROM activity_log WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 100`,
      [patientId]
    );
    return res.rows.map(r => ({
      id: String(r.id),
      doctorId: '',
      doctorName: r.doctor_name,
      patientId: r.patient_id,
      field: r.field,
      previousValue: r.previous_value,
      newValue: r.new_value,
      timestamp: r.recorded_at,
    }));
  },

  // Returns all users with role = 'doctor' (care givers), sorted alphabetically
  async getAllDoctors(): Promise<User[]> {
    const res = await pool.query(`SELECT * FROM users WHERE role = 'doctor' ORDER BY name`);
    return res.rows.map(r => sanitizeUser(rowToUser(r)));
  },

  // ── Appointments ────────────────────────────────────────────────────────────

  // Creates a new appointment row in the database
  async bookAppointment(data: Omit<Appointment, 'id' | 'createdAt'>): Promise<Appointment> {
    const id = generateId();
    const res = await pool.query(
      `INSERT INTO appointments (id, patient_id, doctor_id, doctor_name, patient_name, date, time, specialty, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, data.patientId, data.doctorId, data.doctorName, data.patientName,
       data.date, data.time, data.specialty, data.notes, data.status]
    );
    return rowToAppointment(res.rows[0]);
  },

  // Fetches all appointments for a patient, sorted chronologically
  async getPatientAppointments(patientId: string): Promise<Appointment[]> {
    const res = await pool.query(
      `SELECT * FROM appointments WHERE patient_id = $1 ORDER BY date ASC, time ASC`,
      [patientId]
    );
    return res.rows.map(rowToAppointment);
  },

  // Fetches all appointments for a care giver, sorted chronologically
  async getDoctorAppointments(doctorId: string): Promise<Appointment[]> {
    const res = await pool.query(
      `SELECT * FROM appointments WHERE doctor_id = $1 ORDER BY date ASC, time ASC`,
      [doctorId]
    );
    return res.rows.map(rowToAppointment);
  },

  // Care giver can change appointment status (pending → confirmed, etc.)
  async updateAppointmentStatus(id: string, status: Appointment['status']): Promise<Appointment> {
    const res = await pool.query(
      `UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (res.rows.length === 0) throw new Error('Appointment not found');
    return rowToAppointment(res.rows[0]);
  },

  // Patient cancels (deletes) their own appointment — only the owner can cancel
  async cancelAppointment(id: string, patientId: string): Promise<void> {
    await pool.query(
      `DELETE FROM appointments WHERE id = $1 AND patient_id = $2`,
      [id, patientId]
    );
  },

  // ── Prescriptions ───────────────────────────────────────────────────────────

  // Care giver prescribes a medication; also writes an activity log entry
  async prescribeMedication(data: Omit<Prescription, 'id' | 'prescribedAt'>): Promise<Prescription> {
    const id = generateId();
    const res = await pool.query(
      `INSERT INTO prescriptions (id, patient_id, doctor_id, doctor_name, medication_name, dosage, frequency, times, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, data.patientId, data.doctorId, data.doctorName, data.medicationName,
       data.dosage, data.frequency, data.times, data.notes]
    );

    // Record this action in the care giver's activity log for the patient
    await pool.query(
      `INSERT INTO activity_log (patient_id, field, previous_value, new_value, doctor_name)
       VALUES ($1, 'prescription', 'none', $2, $3)`,
      [data.patientId, `${data.medicationName} ${data.dosage} (${data.frequency})`, data.doctorName]
    );

    return rowToPrescription(res.rows[0]);
  },

  // Fetches all prescriptions for a patient (newest first)
  async getPatientPrescriptions(patientId: string): Promise<Prescription[]> {
    const res = await pool.query(
      `SELECT * FROM prescriptions WHERE patient_id = $1 ORDER BY prescribed_at DESC`,
      [patientId]
    );
    return res.rows.map(rowToPrescription);
  },

  // Fetches all prescriptions written by a care giver, with patient names joined in
  async getDoctorPrescriptions(doctorId: string): Promise<(Prescription & { patientName: string })[]> {
    const res = await pool.query(
      `SELECT p.*, u.name as patient_name FROM prescriptions p
       JOIN users u ON u.id = p.patient_id
       WHERE p.doctor_id = $1 ORDER BY p.prescribed_at DESC`,
      [doctorId]
    );
    return res.rows.map(r => ({ ...rowToPrescription(r), patientName: r.patient_name }));
  },

  // Removes a prescription — only the prescribing care giver can delete it
  async deletePrescription(id: string, doctorId: string): Promise<void> {
    await pool.query(
      `DELETE FROM prescriptions WHERE id = $1 AND doctor_id = $2`,
      [id, doctorId]
    );
  },

  // ── Nutrition Tables Initialisation ─────────────────────────────────────────
  // Creates the nutrition-related tables at server startup if they don't exist.
  // Using CREATE TABLE IF NOT EXISTS means this is safe to call every restart.
  async initNutritionTables(): Promise<void> {
    // food_log: individual food items a patient logs manually (legacy)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_log (
        id VARCHAR PRIMARY KEY,
        patient_id VARCHAR NOT NULL,
        meal_type VARCHAR NOT NULL,
        food_name VARCHAR NOT NULL,
        calories INTEGER NOT NULL DEFAULT 0,
        protein DECIMAL NOT NULL DEFAULT 0,
        carbs DECIMAL NOT NULL DEFAULT 0,
        fat DECIMAL NOT NULL DEFAULT 0,
        quantity VARCHAR NOT NULL DEFAULT '1 serving',
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        logged_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // nutrition_goals: one row per patient, set/edited by the care giver
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nutrition_goals (
        patient_id VARCHAR PRIMARY KEY,
        calories INTEGER NOT NULL DEFAULT 2000,
        protein INTEGER NOT NULL DEFAULT 120,
        carbs INTEGER NOT NULL DEFAULT 250,
        fat INTEGER NOT NULL DEFAULT 65,
        water INTEGER NOT NULL DEFAULT 8,
        doctor_note TEXT,       -- Care giver's message to the patient
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // water_log: one row per patient per day, tracks glasses of water
    await pool.query(`
      CREATE TABLE IF NOT EXISTS water_log (
        patient_id VARCHAR NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        glasses INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (patient_id, date)  -- Composite PK prevents duplicate entries
      )
    `);
  },

  // ── Food Log CRUD ────────────────────────────────────────────────────────────

  // Returns all food entries for a patient on a specific date
  async getFoodLog(patientId: string, date: string): Promise<FoodEntry[]> {
    const res = await pool.query(
      `SELECT * FROM food_log WHERE patient_id = $1 AND date = $2 ORDER BY logged_at ASC`,
      [patientId, date]
    );
    return res.rows.map(r => ({
      id: r.id, patientId: r.patient_id, mealType: r.meal_type,
      foodName: r.food_name, calories: r.calories,
      protein: Number(r.protein), carbs: Number(r.carbs), fat: Number(r.fat),
      quantity: r.quantity, date: r.date, loggedAt: r.logged_at,
    }));
  },

  // Inserts a new food log entry and returns the saved row
  async addFoodEntry(data: Omit<FoodEntry, 'id' | 'loggedAt'>): Promise<FoodEntry> {
    const id = generateId();
    const res = await pool.query(
      `INSERT INTO food_log (id, patient_id, meal_type, food_name, calories, protein, carbs, fat, quantity, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, data.patientId, data.mealType, data.foodName, data.calories,
       data.protein, data.carbs, data.fat, data.quantity, data.date]
    );
    const r = res.rows[0];
    return { id: r.id, patientId: r.patient_id, mealType: r.meal_type, foodName: r.food_name,
      calories: r.calories, protein: Number(r.protein), carbs: Number(r.carbs),
      fat: Number(r.fat), quantity: r.quantity, date: r.date, loggedAt: r.logged_at };
  },

  // Deletes a food entry — patient_id check ensures patients can only delete their own entries
  async removeFoodEntry(id: string, patientId: string): Promise<void> {
    await pool.query(`DELETE FROM food_log WHERE id = $1 AND patient_id = $2`, [id, patientId]);
  },

  // ── Nutrition Goals ──────────────────────────────────────────────────────────

  // Returns a patient's nutrition goals; returns sensible defaults if none set yet
  async getNutritionGoals(patientId: string): Promise<NutritionGoals> {
    const res = await pool.query(`SELECT * FROM nutrition_goals WHERE patient_id = $1`, [patientId]);
    if (res.rows.length === 0) {
      // Return default goals instead of null so the UI always has values to show
      return { patientId, calories: 2000, protein: 120, carbs: 250, fat: 65, water: 8 };
    }
    const r = res.rows[0];
    return { patientId: r.patient_id, calories: r.calories, protein: r.protein,
      carbs: r.carbs, fat: r.fat, water: r.water, doctorNote: r.doctor_note };
  },

  // Upserts nutrition goals — creates a new row or updates the existing one
  async setNutritionGoals(data: NutritionGoals): Promise<NutritionGoals> {
    await pool.query(
      `INSERT INTO nutrition_goals (patient_id, calories, protein, carbs, fat, water, doctor_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (patient_id) DO UPDATE SET calories=$2, protein=$3, carbs=$4, fat=$5, water=$6, doctor_note=$7, updated_at=NOW()`,
      [data.patientId, data.calories, data.protein, data.carbs, data.fat, data.water, data.doctorNote || null]
    );
    return data;
  },

  // ── Water Log ────────────────────────────────────────────────────────────────

  // Returns how many glasses of water a patient has drunk on a specific date
  async getWaterCount(patientId: string, date: string): Promise<number> {
    const res = await pool.query(`SELECT glasses FROM water_log WHERE patient_id=$1 AND date=$2`, [patientId, date]);
    return res.rows.length > 0 ? res.rows[0].glasses : 0;
  },

  // Upserts the water count for today; clamps value between 0 and 12 glasses
  async setWaterCount(patientId: string, date: string, glasses: number): Promise<number> {
    await pool.query(
      `INSERT INTO water_log (patient_id, date, glasses) VALUES ($1, $2, $3)
       ON CONFLICT (patient_id, date) DO UPDATE SET glasses=$3`,
      [patientId, date, Math.max(0, Math.min(glasses, 12))]
    );
    return glasses;
  },

  // ── Meal Plan Tables Initialisation ──────────────────────────────────────────
  // Creates meal plan and confirmation tables if they don't exist.
  async initMealPlanTables(): Promise<void> {
    // meal_plans: care giver's approved meals for a patient (permanent plan)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meal_plans (
        id VARCHAR PRIMARY KEY,
        patient_id VARCHAR NOT NULL,
        care_giver_id VARCHAR NOT NULL,
        care_giver_name VARCHAR NOT NULL,
        meal_type VARCHAR NOT NULL,      -- breakfast / lunch / dinner / snack
        food_name VARCHAR NOT NULL,
        scheduled_time VARCHAR NOT NULL, -- "HH:MM" e.g. "08:00"
        calories INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // meal_confirmations: tracks which meals the patient confirmed eating each day
    // Composite primary key prevents a patient confirming the same meal twice in one day
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meal_confirmations (
        patient_id VARCHAR NOT NULL,
        meal_plan_id VARCHAR NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        confirmed_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (patient_id, meal_plan_id, date)
      )
    `);
  },

  // ── Meal Plan CRUD ───────────────────────────────────────────────────────────

  // Care giver adds a meal to a patient's plan
  async addMealPlan(data: {
    patientId: string;
    careGiverId: string;
    careGiverName: string;
    mealType: string;
    foodName: string;
    scheduledTime: string;
    calories: number;
    notes?: string;
  }): Promise<any> {
    const id = generateId();
    const res = await pool.query(
      `INSERT INTO meal_plans (id, patient_id, care_giver_id, care_giver_name, meal_type, food_name, scheduled_time, calories, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, data.patientId, data.careGiverId, data.careGiverName, data.mealType,
       data.foodName, data.scheduledTime, data.calories, data.notes || null]
    );
    const r = res.rows[0];
    return {
      id: r.id, patientId: r.patient_id, careGiverId: r.care_giver_id,
      careGiverName: r.care_giver_name, mealType: r.meal_type, foodName: r.food_name,
      scheduledTime: r.scheduled_time, calories: r.calories, notes: r.notes,
      createdAt: r.created_at,
    };
  },

  // Returns all meals in a patient's plan, sorted by scheduled time
  async getMealPlans(patientId: string): Promise<any[]> {
    const res = await pool.query(
      `SELECT * FROM meal_plans WHERE patient_id = $1 ORDER BY scheduled_time ASC`,
      [patientId]
    );
    return res.rows.map(r => ({
      id: r.id, patientId: r.patient_id, careGiverId: r.care_giver_id,
      careGiverName: r.care_giver_name, mealType: r.meal_type, foodName: r.food_name,
      scheduledTime: r.scheduled_time, calories: r.calories, notes: r.notes,
      createdAt: r.created_at,
    }));
  },

  // Care giver removes a meal from the plan.
  // Also deletes all confirmations so stale data doesn't remain.
  async deleteMealPlan(id: string, careGiverId: string): Promise<void> {
    await pool.query(`DELETE FROM meal_plans WHERE id = $1 AND care_giver_id = $2`, [id, careGiverId]);
    await pool.query(`DELETE FROM meal_confirmations WHERE meal_plan_id = $1`, [id]);
  },

  // ── Meal Confirmations ───────────────────────────────────────────────────────

  // Patient marks a meal as eaten today — ON CONFLICT DO NOTHING prevents duplicates
  async confirmMeal(patientId: string, mealPlanId: string, date: string): Promise<void> {
    await pool.query(
      `INSERT INTO meal_confirmations (patient_id, meal_plan_id, date)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [patientId, mealPlanId, date]
    );
  },

  // Patient unchecks a meal — removes today's confirmation for that meal
  async unconfirmMeal(patientId: string, mealPlanId: string, date: string): Promise<void> {
    await pool.query(
      `DELETE FROM meal_confirmations WHERE patient_id = $1 AND meal_plan_id = $2 AND date = $3`,
      [patientId, mealPlanId, date]
    );
  },

  // Returns the list of meal plan IDs the patient has confirmed eating today
  async getMealConfirmations(patientId: string, date: string): Promise<string[]> {
    const res = await pool.query(
      `SELECT meal_plan_id FROM meal_confirmations WHERE patient_id = $1 AND date = $2`,
      [patientId, date]
    );
    return res.rows.map(r => r.meal_plan_id);
  },

  // ── Fall Detection ───────────────────────────────────────────────────────────

  // Creates the fall_events table at startup — stores accelerometer-detected falls
  async initFallTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fall_events (
        id VARCHAR PRIMARY KEY,
        patient_id VARCHAR NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'detected',  -- detected / confirmed / dismissed
        acceleration_x DECIMAL NOT NULL DEFAULT 0,
        acceleration_y DECIMAL NOT NULL DEFAULT 0,
        acceleration_z DECIMAL NOT NULL DEFAULT 0,
        magnitude DECIMAL NOT NULL DEFAULT 0,        -- Combined acceleration magnitude
        ai_analysis TEXT,       -- GPT-4o's textual analysis of the fall
        ai_result VARCHAR,      -- "fall" or "no_fall"
        ai_confidence INTEGER,  -- 0-100 confidence score from AI
        location_lat DECIMAL,   -- GPS coordinates if available
        location_lng DECIMAL,
        detected_at TIMESTAMP DEFAULT NOW()
      )
    `);
  },

  // Saves a new fall event detected by the patient's accelerometer
  async logFallEvent(data: {
    patientId: string;
    accelerationX: number;
    accelerationY: number;
    accelerationZ: number;
    magnitude: number;
    locationLat?: number;
    locationLng?: number;
  }): Promise<string> {
    const id = generateId();
    await pool.query(
      `INSERT INTO fall_events (id, patient_id, status, acceleration_x, acceleration_y, acceleration_z, magnitude, location_lat, location_lng)
       VALUES ($1, $2, 'detected', $3, $4, $5, $6, $7, $8)`,
      [id, data.patientId, data.accelerationX, data.accelerationY, data.accelerationZ, data.magnitude, data.locationLat || null, data.locationLng || null]
    );
    return id; // Return the new ID so the caller can poll for AI result updates
  },

  // After GPT-4o analyses the event, store the result back on the row
  async updateFallStatus(id: string, patientId: string, status: string, aiResult?: string, aiAnalysis?: string, aiConfidence?: number): Promise<void> {
    await pool.query(
      `UPDATE fall_events SET status=$3, ai_result=$4, ai_analysis=$5, ai_confidence=$6 WHERE id=$1 AND patient_id=$2`,
      [id, patientId, status, aiResult || null, aiAnalysis || null, aiConfidence || null]
    );
  },

  // Returns a single fall event by ID, scoped to the patient for security
  async getFallEventById(id: string, patientId: string): Promise<any | null> {
    const res = await pool.query(
      `SELECT * FROM fall_events WHERE id=$1 AND patient_id=$2`,
      [id, patientId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      patientId: r.patient_id,
      status: r.status,
      accelerationX: Number(r.acceleration_x),
      accelerationY: Number(r.acceleration_y),
      accelerationZ: Number(r.acceleration_z),
      magnitude: Number(r.magnitude),
      aiAnalysis: r.ai_analysis,
      aiResult: r.ai_result,
      aiConfidence: r.ai_confidence,
      locationLat: r.location_lat ? Number(r.location_lat) : null,
      locationLng: r.location_lng ? Number(r.location_lng) : null,
      detectedAt: r.detected_at,
    };
  },

  // Returns recent fall events for a patient (newest first)
  async getFallEvents(patientId: string, limit = 20): Promise<any[]> {
    const res = await pool.query(
      `SELECT * FROM fall_events WHERE patient_id=$1 ORDER BY detected_at DESC LIMIT $2`,
      [patientId, limit]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      patientId: r.patient_id,
      status: r.status,
      accelerationX: Number(r.acceleration_x),
      accelerationY: Number(r.acceleration_y),
      accelerationZ: Number(r.acceleration_z),
      magnitude: Number(r.magnitude),
      aiAnalysis: r.ai_analysis,
      aiResult: r.ai_result,
      aiConfidence: r.ai_confidence,
      locationLat: r.location_lat ? Number(r.location_lat) : null,
      locationLng: r.location_lng ? Number(r.location_lng) : null,
      detectedAt: r.detected_at,
    }));
  },

  // ── Care Giver Patient Assignments ────────────────────────────────────────
  // Lets care givers maintain a personal list of patients they actively monitor.
  // The composite primary key (care_giver_id, patient_id) prevents duplicates.

  // Create the table on first startup — safe to call multiple times (IF NOT EXISTS)
  async initCareGiverPatientsTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS care_giver_patients (
        care_giver_id VARCHAR(64) NOT NULL,
        patient_id    VARCHAR(64) NOT NULL,
        added_at      TIMESTAMP  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (care_giver_id, patient_id)
      )
    `);
  },

  // Add a patient to the care giver's personal list (silently ignores duplicates)
  async addPatientToCaregiver(careGiverId: string, patientId: string): Promise<void> {
    await pool.query(
      `INSERT INTO care_giver_patients (care_giver_id, patient_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [careGiverId, patientId]
    );
  },

  // Remove a patient from the care giver's personal list
  async removePatientFromCaregiver(careGiverId: string, patientId: string): Promise<void> {
    await pool.query(
      `DELETE FROM care_giver_patients WHERE care_giver_id=$1 AND patient_id=$2`,
      [careGiverId, patientId]
    );
  },

  // Return full user details for every patient the care giver has added, newest first
  async getCareGiverPatients(careGiverId: string): Promise<User[]> {
    const res = await pool.query(
      `SELECT u.* FROM users u
       INNER JOIN care_giver_patients cgp ON cgp.patient_id = u.id
       WHERE cgp.care_giver_id = $1
       ORDER BY cgp.added_at DESC`,
      [careGiverId]
    );
    return res.rows.map(rowToUser);
  },

  // ── Push Token Table ──────────────────────────────────────────────────────────
  // Stores one Expo push token per user (upserted on every login).
  // Used to send push notifications to caregivers when a fall is detected.

  async initPushTokensTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        user_id    VARCHAR(64) PRIMARY KEY,
        token      TEXT        NOT NULL,
        updated_at TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);
  },

  async savePushToken(userId: string, token: string): Promise<void> {
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET token = $2, updated_at = NOW()`,
      [userId, token]
    );
  },

  // Returns all Expo push tokens for caregivers who are monitoring this patient (by internal user UUID)
  async getCaregiversPushTokensForPatient(patientUserId: string): Promise<string[]> {
    const res = await pool.query(
      `SELECT pt.token
       FROM push_tokens pt
       INNER JOIN care_giver_patients cgp ON cgp.care_giver_id = pt.user_id
       WHERE cgp.patient_id = $1`,
      [patientUserId]
    );
    return res.rows.map((r: any) => r.token);
  },
};
