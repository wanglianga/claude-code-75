import db, { mapPatient, mapAppointment, mapEscalation, J } from './db.js';
import { uid, nowIso } from './util.js';

/** 医保剩余次数 ≤ 该阈值时触发「次数不足」确认流 */
export const INSURANCE_WARN_THRESHOLD = 2;

export function addStep(eventId, user, action, note = '') {
  db.prepare('INSERT INTO event_steps(id,event_id,user_id,role,user_name,action,note,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(uid(), eventId, user.id, user.role, user.name, action, note, nowIso());
}

export function createEvent({
  patientId = null, appointmentId = null, planId = null, equipmentId = null,
  type, title, status = 'open', detail = {}, user = null,
}) {
  const id = uid();
  db.prepare(`INSERT INTO events(id,patient_id,appointment_id,plan_id,equipment_id,type,title,status,detail,created_by,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, patientId, appointmentId, planId, equipmentId, type, title, status, JSON.stringify(detail),
      user ? user.name : '系统', nowIso());
  if (user) addStep(id, user, '发起', detail.note || title);
  return id;
}

export function getPatientRow(id) {
  return db.prepare('SELECT * FROM patients WHERE id=?').get(id);
}

export function getPatient(id) {
  const r = getPatientRow(id);
  return r ? mapPatient(r) : null;
}

export function getAppointmentRow(id) {
  return db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
}

export function getAppointment(id) {
  const r = db.prepare(`SELECT a.*, p.name patient_name, t.name therapist_name, e.name equipment_name
    FROM appointments a
    JOIN patients p ON p.id=a.patient_id
    LEFT JOIN users t ON t.id=a.therapist_id
    JOIN equipment e ON e.id=a.equipment_id WHERE a.id=?`).get(id);
  return r ? mapAppointment(r) : null;
}

export function activePlanOf(patientId) {
  return db.prepare("SELECT * FROM plans WHERE patient_id=? AND status='active' ORDER BY version DESC LIMIT 1").get(patientId);
}

export function lastCompletedOf(patientId) {
  return db.prepare(`SELECT * FROM appointments WHERE patient_id=? AND status='completed'
                     ORDER BY date DESC, start DESC LIMIT 1`).get(patientId);
}

/** 向引用了某预约的未结协同事件追加处理记录（如改派/改期后自动留痕） */
export function autoStepForAppointment(appointmentId, types, user, action, note) {
  const rows = db.prepare(`SELECT * FROM events WHERE appointment_id=? AND status!='resolved'`).all(appointmentId)
    .filter((e) => types.includes(e.type));
  for (const e of rows) addStep(e.id, user, action, note);
}

/* ---------------- 疼痛升级 ---------------- */
export function getEscalationRow(id) {
  return db.prepare('SELECT * FROM pain_escalations WHERE id=?').get(id);
}

/** 某患者最近一次未闭环（未交班知悉）的疼痛升级 */
export function pendingEscalationOf(patientId) {
  return db.prepare(`SELECT * FROM pain_escalations
    WHERE patient_id=? AND handover_ack_at IS NULL AND closed_at IS NULL
    ORDER BY created_at DESC LIMIT 1`).get(patientId);
}

/** 升级事件（联表患者/预约/治疗师信息，供交班与 bootstrap 使用） */
export function getEscalationsWithNames(where = '', params = []) {
  return db.prepare(`SELECT pe.*, p.name patient_name, t.name therapist_name,
      a.date AS date, a.start AS start, e.name equipment_name
    FROM pain_escalations pe
    JOIN patients p ON p.id=pe.patient_id
    LEFT JOIN users t ON t.id=pe.therapist_id
    JOIN appointments a ON a.id=pe.appointment_id
    LEFT JOIN equipment e ON e.id=a.equipment_id
    ${where} ORDER BY pe.created_at DESC`).all(...params).map(mapEscalation);
}

/* ---------------- 医保次数不足确认流 ---------------- */

export function getConfirmationRow(id) {
  return db.prepare('SELECT * FROM insurance_confirmations WHERE id=?').get(id);
}

/** 患者某医保项目当前未闭环的确认单（待医生建议/待家属确认） */
export function openConfirmationOf(patientId, itemName) {
  return db.prepare(`SELECT * FROM insurance_confirmations
    WHERE patient_id=? AND insurance_item=? AND status IN ('pending_advice','pending_family')
    ORDER BY created_at DESC LIMIT 1`).get(patientId, itemName);
}

/** 患者医保项目自费额度（家属确认后可用）：返回 { item, remaining, selfPayRemaining } */
export function selfPayInfoOf(patient) {
  const item = (patient.insuranceItems || [])[0];
  if (!item) return { item: null, remaining: 0, selfPayRemaining: 0 };
  const remaining = Math.max(0, (item.total || 0) - (item.used || 0));
  const selfPayRemaining = Math.max(0, (item.selfPayTotal || 0) - (item.selfPayUsed || 0));
  return { item, remaining, selfPayRemaining };
}

/**
 * 预约/核销时检查：医保剩余 ≤ 阈值则确保存在一张未闭环确认单（待医生续开建议），
 * 并生成/复用协同事件。返回确认单行（未触发返回 null）。
 * 已有自费额度（家属已确认）或最近一张被拒绝待医生重开时，不重复创建。
 */
export function ensureInsuranceConfirmation(patientId, user = null) {
  const patient = getPatient(patientId);
  if (!patient) return null;
  const { item, remaining, selfPayRemaining } = selfPayInfoOf(patient);
  if (!item || remaining > INSURANCE_WARN_THRESHOLD) return null;
  if (selfPayRemaining > 0) return null;
  const open = openConfirmationOf(patientId, item.name);
  if (open) return open;
  const last = db.prepare(`SELECT * FROM insurance_confirmations WHERE patient_id=? AND insurance_item=?
    ORDER BY created_at DESC LIMIT 1`).get(patientId, item.name);
  if (last && last.status === 'rejected') return null;
  const id = uid();
  const price = item.selfPayPrice ?? 80;
  const eventId = createEvent({
    patientId, type: 'insurance_shortage',
    title: `${patient.name} 医保「${item.name}」仅剩 ${remaining} 次，待医生续开建议与家属确认`,
    detail: {
      confirmationId: id, item: item.name, remaining, selfPayPrice: price,
      note: `医保康复次数即将用尽（剩余 ${remaining} 次）：请医生填写续开建议，家属确认是否自费继续训练（自费 ¥${price}/次）`,
    },
    user,
  });
  db.prepare(`INSERT INTO insurance_confirmations(id,patient_id,insurance_item,remaining,self_pay_price,status,event_id,created_at)
    VALUES(?,?,?,?,?,'pending_advice',?,?)`).run(id, patientId, item.name, remaining, price, eventId, nowIso());
  return getConfirmationRow(id);
}

/* ---------------- 计划重新确认（器械变更） ---------------- */

export function getReconfirmationRow(id) {
  return db.prepare('SELECT * FROM plan_reconfirmations WHERE id=?').get(id);
}

/** 某预约是否存在待治疗师重新确认的记录 */
export function pendingReconfirmationOf(appointmentId) {
  return db.prepare("SELECT * FROM plan_reconfirmations WHERE appointment_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1")
    .get(appointmentId);
}

/* ---------------- 维修工单 ---------------- */

export function openOrderOfEquipment(equipmentId) {
  return db.prepare("SELECT * FROM maintenance_orders WHERE equipment_id=? AND status!='resolved' ORDER BY created_at DESC LIMIT 1")
    .get(equipmentId);
}
