import db, { mapPatient, mapAppointment, mapEscalation } from './db.js';
import { uid, nowIso } from './util.js';

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
