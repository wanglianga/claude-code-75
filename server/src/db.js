import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 使用 Node.js 内置 SQLite（node:sqlite），无需任何原生编译依赖
const db = new DatabaseSync(path.join(DATA_DIR, 'rehab.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  patient_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS therapist_leaves (
  id TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL,
  date TEXT NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER,
  gender TEXT,
  category TEXT NOT NULL,
  diagnosis TEXT,
  post_op_stage TEXT,
  rom TEXT,
  contraindications TEXT,
  pain_score INTEGER,
  family_accompany INTEGER DEFAULT 0,
  insurance_items TEXT,
  therapist_id TEXT,
  risk_level TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  doctor_orders TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'available',
  suitable_categories TEXT,
  last_disinfected_at TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  goals TEXT,
  items TEXT,
  note TEXT,
  previous_plan_id TEXT,
  created_by TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  therapist_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  plan_id TEXT,
  insurance_item TEXT,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  duration INTEGER NOT NULL,
  status TEXT DEFAULT 'scheduled',
  late INTEGER DEFAULT 0,
  family_consent INTEGER DEFAULT 0,
  checkin TEXT,
  session TEXT,
  feedback TEXT,
  risk_snapshot TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  patient_id TEXT,
  appointment_id TEXT,
  plan_id TEXT,
  equipment_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  detail TEXT,
  created_by TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS event_steps (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT,
  role TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_events_patient ON events(patient_id);
`);

export default db;

/* ---------------- 行 -> API 对象映射 ---------------- */

export const J = (s, fb = null) => {
  if (s === null || s === undefined || s === '') return fb;
  try { return JSON.parse(s); } catch { return fb; }
};

export function mapUser(r) {
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, name: r.name, patientId: r.patient_id || null };
}

export function mapPatient(r) {
  return {
    id: r.id, name: r.name, age: r.age, gender: r.gender, category: r.category,
    diagnosis: r.diagnosis || '', postOpStage: r.post_op_stage || '', rom: r.rom || '',
    contraindications: J(r.contraindications, []), painScore: r.pain_score ?? 0,
    familyAccompany: !!r.family_accompany, insuranceItems: J(r.insurance_items, []),
    therapistId: r.therapist_id || null, riskLevel: r.risk_level || '低',
    emergencyName: r.emergency_name || '', emergencyPhone: r.emergency_phone || '',
    doctorOrders: r.doctor_orders || '', status: r.status || 'active', createdAt: r.created_at,
  };
}

export function mapEquipment(r) {
  return {
    id: r.id, name: r.name, type: r.type, status: r.status,
    suitableCategories: J(r.suitable_categories, []),
    lastDisinfectedAt: r.last_disinfected_at || null, note: r.note || '',
  };
}

export function mapPlan(r) {
  return {
    id: r.id, patientId: r.patient_id, version: r.version, status: r.status,
    goals: r.goals || '', items: J(r.items, []), note: r.note || '',
    previousPlanId: r.previous_plan_id || null, createdBy: r.created_by || '', createdAt: r.created_at,
  };
}

export function mapAppointment(r) {
  return {
    id: r.id, patientId: r.patient_id, therapistId: r.therapist_id, equipmentId: r.equipment_id,
    planId: r.plan_id || null, insuranceItem: r.insurance_item || null,
    date: r.date, start: r.start, duration: r.duration, status: r.status,
    late: !!r.late, familyConsent: !!r.family_consent,
    checkin: J(r.checkin), session: J(r.session), feedback: J(r.feedback),
    riskSnapshot: J(r.risk_snapshot), createdAt: r.created_at,
    patientName: r.patient_name, therapistName: r.therapist_name, equipmentName: r.equipment_name,
  };
}

export function mapStep(r) {
  return {
    id: r.id, eventId: r.event_id, role: r.role, userName: r.user_name,
    action: r.action, note: r.note || '', createdAt: r.created_at,
  };
}

export function mapEvent(r, steps = []) {
  return {
    id: r.id, patientId: r.patient_id || null, appointmentId: r.appointment_id || null,
    planId: r.plan_id || null, equipmentId: r.equipment_id || null,
    type: r.type, title: r.title, status: r.status, detail: J(r.detail, {}),
    createdBy: r.created_by || '', createdAt: r.created_at,
    patientName: r.patient_name || null, steps,
  };
}
