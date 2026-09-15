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
  risk_tags TEXT,
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
CREATE TABLE IF NOT EXISTS pain_escalations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  therapist_id TEXT NOT NULL,
  pain_before INTEGER NOT NULL,
  pain_peak INTEGER NOT NULL,
  pain_change INTEGER NOT NULL,
  patient_words TEXT,
  action_angle TEXT,
  action_pause INTEGER DEFAULT 0,
  action_ice INTEGER DEFAULT 0,
  action_notify_doctor INTEGER DEFAULT 0,
  notify_family INTEGER DEFAULT 0,
  next_intensity TEXT,
  next_interval_days INTEGER,
  doctor_advice TEXT,
  doctor_advice_by TEXT,
  doctor_advice_at TEXT,
  handover_ack_by TEXT,
  handover_ack_name TEXT,
  handover_ack_at TEXT,
  closed_at TEXT,
  closed_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escal_patient ON pain_escalations(patient_id);
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
-- 医保次数不足确认单：剩余次数/自费价格/医生续开建议/家属确认/治疗师说明 全流程留痕
CREATE TABLE IF NOT EXISTS insurance_confirmations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  insurance_item TEXT NOT NULL,
  remaining INTEGER NOT NULL,
  self_pay_price REAL NOT NULL,
  doctor_advice TEXT,
  doctor_advice_by TEXT,
  doctor_advice_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending_advice',
  confirmer_name TEXT,
  confirm_sessions INTEGER,
  confirm_amount REAL,
  therapist_note TEXT,
  therapist_note_by TEXT,
  decided_at TEXT,
  pause_reason TEXT,
  event_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insc_patient ON insurance_confirmations(patient_id);
-- 前台收费记录（关联确认单，收费争议可追溯：确认人/金额/治疗师说明）
CREATE TABLE IF NOT EXISTS billing_records (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  confirmation_id TEXT,
  item TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  amount REAL NOT NULL,
  pay_type TEXT NOT NULL DEFAULT 'self_pay',
  status TEXT NOT NULL DEFAULT 'unpaid',
  confirmer_name TEXT,
  therapist_note TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_patient ON billing_records(patient_id);
-- 器械维修工单（含消毒状态，维修+消毒双完成器械才恢复可用）
CREATE TABLE IF NOT EXISTS maintenance_orders (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  disinfection_status TEXT NOT NULL DEFAULT 'pending',
  reported_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mo_equip ON maintenance_orders(equipment_id);
-- 器械变更后的训练计划重新确认（替代器械训练效果不同→治疗师重确认目标与动作范围）
CREATE TABLE IF NOT EXISTS plan_reconfirmations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  plan_id TEXT,
  appointment_id TEXT NOT NULL,
  from_equipment_id TEXT NOT NULL,
  to_equipment_id TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  old_goals TEXT, old_rom TEXT, old_estimated_sessions INTEGER, old_patient_reminder TEXT,
  new_goals TEXT, new_rom TEXT, new_estimated_sessions INTEGER, new_patient_reminder TEXT,
  confirmed_by TEXT, confirmed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recf_patient ON plan_reconfirmations(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_events_patient ON events(patient_id);
`);

// 旧数据卷轻量迁移：补齐新增列（IF NOT EXISTS 不支持 ADD COLUMN）
const patientCols = db.prepare('PRAGMA table_info(patients)').all().map((c) => c.name);
if (!patientCols.includes('risk_tags')) db.exec('ALTER TABLE patients ADD COLUMN risk_tags TEXT');
const equipCols = db.prepare('PRAGMA table_info(equipment)').all().map((c) => c.name);
if (!equipCols.includes('effect_group')) db.exec("ALTER TABLE equipment ADD COLUMN effect_group TEXT DEFAULT ''");
if (!equipCols.includes('effect_desc')) db.exec("ALTER TABLE equipment ADD COLUMN effect_desc TEXT DEFAULT ''");
const planCols = db.prepare('PRAGMA table_info(plans)').all().map((c) => c.name);
if (!planCols.includes('rom')) db.exec("ALTER TABLE plans ADD COLUMN rom TEXT DEFAULT ''");
if (!planCols.includes('estimated_sessions')) db.exec('ALTER TABLE plans ADD COLUMN estimated_sessions INTEGER');
if (!planCols.includes('patient_reminder')) db.exec("ALTER TABLE plans ADD COLUMN patient_reminder TEXT DEFAULT ''");
const apptCols = db.prepare('PRAGMA table_info(appointments)').all().map((c) => c.name);
if (!apptCols.includes('pay_type')) db.exec("ALTER TABLE appointments ADD COLUMN pay_type TEXT DEFAULT 'insurance'");

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
    doctorOrders: r.doctor_orders || '', riskTags: J(r.risk_tags, []),
    status: r.status || 'active', createdAt: r.created_at,
  };
}

export function mapEquipment(r) {
  return {
    id: r.id, name: r.name, type: r.type, status: r.status,
    suitableCategories: J(r.suitable_categories, []),
    lastDisinfectedAt: r.last_disinfected_at || null, note: r.note || '',
    effectGroup: r.effect_group || '', effectDesc: r.effect_desc || '',
  };
}

export function mapPlan(r) {
  return {
    id: r.id, patientId: r.patient_id, version: r.version, status: r.status,
    goals: r.goals || '', items: J(r.items, []), note: r.note || '',
    rom: r.rom || '', estimatedSessions: r.estimated_sessions ?? null,
    patientReminder: r.patient_reminder || '',
    previousPlanId: r.previous_plan_id || null, createdBy: r.created_by || '', createdAt: r.created_at,
  };
}

export function mapAppointment(r) {
  return {
    id: r.id, patientId: r.patient_id, therapistId: r.therapist_id, equipmentId: r.equipment_id,
    planId: r.plan_id || null, insuranceItem: r.insurance_item || null,
    date: r.date, start: r.start, duration: r.duration, status: r.status,
    late: !!r.late, familyConsent: !!r.family_consent, payType: r.pay_type || 'insurance',
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

export function mapEscalation(r) {
  if (!r) return null;
  return {
    id: r.id, patientId: r.patient_id, appointmentId: r.appointment_id, therapistId: r.therapist_id,
    painBefore: r.pain_before, painPeak: r.pain_peak, painChange: r.pain_change,
    patientWords: r.patient_words || '',
    actionPause: !!r.action_pause, actionAngle: r.action_angle || '',
    actionIce: !!r.action_ice, actionNotifyDoctor: !!r.action_notify_doctor,
    notifyFamily: !!r.notify_family,
    nextIntensity: r.next_intensity || '', nextIntervalDays: r.next_interval_days ?? null,
    doctorAdvice: r.doctor_advice || '', doctorAdviceBy: r.doctor_advice_by || '', doctorAdviceAt: r.doctor_advice_at || null,
    handoverAckBy: r.handover_ack_by || null, handoverAckName: r.handover_ack_name || '', handoverAckAt: r.handover_ack_at || null,
    closedAt: r.closed_at || null, closedBy: r.closed_by || '',
    createdAt: r.created_at,
    // 联表补充（getEscalationsWithNames 填充）
    patientName: r.patient_name || undefined, therapistName: r.therapist_name || undefined,
    date: r.date || undefined, start: r.start || undefined, equipmentName: r.equipment_name || undefined,
  };
}

/* ---------------- 医保不足确认单 ---------------- */
export function mapConfirmation(r) {
  if (!r) return null;
  return {
    id: r.id, patientId: r.patient_id, insuranceItem: r.insurance_item,
    remaining: r.remaining, selfPayPrice: r.self_pay_price,
    doctorAdvice: r.doctor_advice || '', doctorAdviceBy: r.doctor_advice_by || '', doctorAdviceAt: r.doctor_advice_at || null,
    status: r.status,
    confirmerName: r.confirmer_name || '', confirmSessions: r.confirm_sessions ?? null,
    confirmAmount: r.confirm_amount ?? null,
    therapistNote: r.therapist_note || '', therapistNoteBy: r.therapist_note_by || '',
    decidedAt: r.decided_at || null, pauseReason: r.pause_reason || '',
    eventId: r.event_id || null, createdAt: r.created_at,
    patientName: r.patient_name || undefined,
  };
}

/* ---------------- 收费记录 ---------------- */
export function mapBilling(r) {
  if (!r) return null;
  return {
    id: r.id, patientId: r.patient_id, confirmationId: r.confirmation_id || null,
    item: r.item, sessions: r.sessions, amount: r.amount, payType: r.pay_type || 'self_pay',
    status: r.status, confirmerName: r.confirmer_name || '', therapistNote: r.therapist_note || '',
    note: r.note || '', createdAt: r.created_at, paidAt: r.paid_at || null,
    patientName: r.patient_name || undefined,
  };
}

/* ---------------- 器械维修工单 ---------------- */
export function mapMaintenanceOrder(r) {
  if (!r) return null;
  return {
    id: r.id, equipmentId: r.equipment_id, issueType: r.issue_type,
    description: r.description || '', status: r.status,
    disinfectionStatus: r.disinfection_status || 'pending',
    reportedBy: r.reported_by || '', createdAt: r.created_at,
    updatedAt: r.updated_at || null, resolvedAt: r.resolved_at || null,
    equipmentName: r.equipment_name || undefined, equipmentType: r.equipment_type || undefined,
  };
}

/* ---------------- 计划重新确认（器械变更） ---------------- */
export function mapReconfirmation(r) {
  if (!r) return null;
  return {
    id: r.id, patientId: r.patient_id, planId: r.plan_id || null, appointmentId: r.appointment_id,
    fromEquipmentId: r.from_equipment_id, toEquipmentId: r.to_equipment_id,
    reason: r.reason || '', status: r.status,
    oldGoals: r.old_goals || '', oldRom: r.old_rom || '',
    oldEstimatedSessions: r.old_estimated_sessions ?? null, oldPatientReminder: r.old_patient_reminder || '',
    newGoals: r.new_goals || '', newRom: r.new_rom || '',
    newEstimatedSessions: r.new_estimated_sessions ?? null, newPatientReminder: r.new_patient_reminder || '',
    confirmedBy: r.confirmed_by || '', confirmedAt: r.confirmed_at || null, createdAt: r.created_at,
    patientName: r.patient_name || undefined,
    fromEquipmentName: r.from_equipment_name || undefined, toEquipmentName: r.to_equipment_name || undefined,
    apptDate: r.appt_date || undefined, apptStart: r.appt_start || undefined,
  };
}
