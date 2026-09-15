import { Router } from 'express';
import db, {
  mapPatient, mapEquipment, mapPlan, mapAppointment, mapEvent, mapStep, mapEscalation,
} from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { CATEGORIES, EVENT_TYPES, ROLE_LABELS, EQUIPMENT_TYPES } from '../domain/population.js';
import { createEvent, addStep } from '../helpers.js';
import { uid, nowIso } from '../util.js';

const router = Router();

router.get('/meta', (req, res) => {
  res.json({
    categories: CATEGORIES,
    eventTypes: EVENT_TYPES,
    roles: ROLE_LABELS,
    equipmentTypes: EQUIPMENT_TYPES,
  });
});

function therapistsInfo() {
  const therapists = db.prepare("SELECT id,name FROM users WHERE role='therapist'").all();
  const schedules = db.prepare('SELECT * FROM schedules').all();
  const leaves = db.prepare('SELECT * FROM therapist_leaves').all();
  return therapists.map((t) => ({
    id: t.id,
    name: t.name,
    schedules: schedules.filter((s) => s.therapist_id === t.id)
      .map((s) => ({ weekday: s.weekday, start: s.start, end: s.end })),
    leaves: leaves.filter((l) => l.therapist_id === t.id).map((l) => ({ date: l.date, reason: l.reason || '' })),
  }));
}

router.get('/bootstrap', authRequired, (req, res) => {
  const { user } = req;
  const scoped = user.role === 'patient' || user.role === 'family';
  const pid = user.patient_id;

  const patients = scoped
    ? db.prepare('SELECT * FROM patients WHERE id=?').all(pid)
    : db.prepare('SELECT * FROM patients ORDER BY created_at').all();

  const apptBase = `SELECT a.*, p.name patient_name, t.name therapist_name, e.name equipment_name
    FROM appointments a
    JOIN patients p ON p.id=a.patient_id
    LEFT JOIN users t ON t.id=a.therapist_id
    JOIN equipment e ON e.id=a.equipment_id`;
  const appointments = scoped
    ? db.prepare(`${apptBase} WHERE a.patient_id=? ORDER BY a.date DESC, a.start DESC`).all(pid)
    : db.prepare(`${apptBase} ORDER BY a.date DESC, a.start DESC`).all();

  const eventBase = `SELECT ev.*, p.name patient_name FROM events ev LEFT JOIN patients p ON p.id=ev.patient_id`;
  const eventRows = scoped
    ? db.prepare(`${eventBase} WHERE ev.patient_id=? OR ev.patient_id IS NULL ORDER BY ev.created_at DESC`).all(pid)
    : db.prepare(`${eventBase} ORDER BY ev.created_at DESC`).all();
  const stepRows = db.prepare('SELECT * FROM event_steps ORDER BY created_at').all();
  const stepsByEvent = {};
  for (const s of stepRows) {
    (stepsByEvent[s.event_id] = stepsByEvent[s.event_id] || []).push(mapStep(s));
  }

  const plans = scoped
    ? db.prepare('SELECT * FROM plans WHERE patient_id=? ORDER BY version DESC').all(pid)
    : db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all();

  const escBase = `SELECT pe.*, p.name patient_name, t.name therapist_name,
    a.date AS date, a.start AS start, e.name equipment_name
    FROM pain_escalations pe
    JOIN patients p ON p.id=pe.patient_id
    LEFT JOIN users t ON t.id=pe.therapist_id
    JOIN appointments a ON a.id=pe.appointment_id
    LEFT JOIN equipment e ON e.id=a.equipment_id`;
  const escalations = scoped
    ? db.prepare(`${escBase} WHERE pe.patient_id=? ORDER BY pe.created_at DESC`).all(pid)
    : db.prepare(`${escBase} ORDER BY pe.created_at DESC`).all();

  res.json({
    patients: patients.map(mapPatient),
    appointments: appointments.map(mapAppointment),
    events: eventRows.map((e) => mapEvent(e, stepsByEvent[e.id] || [])),
    escalations: escalations.map(mapEscalation),
    equipment: db.prepare('SELECT * FROM equipment ORDER BY name').all().map(mapEquipment),
    plans: plans.map(mapPlan),
    therapists: therapistsInfo(),
  });
});

/* ---------- 治疗师请假：自动找出受影响预约并生成协同事件 ---------- */
router.post('/therapists/:id/leave', authRequired, requireRole('therapist', 'frontdesk'), (req, res) => {
  const { date, reason } = req.body || {};
  const tid = req.params.id;
  if (!date) return res.status(400).json({ error: '请选择请假日期' });
  if (req.user.role === 'therapist' && req.user.id !== tid) return res.status(403).json({ error: '只能登记本人请假' });
  const exists = db.prepare('SELECT 1 FROM therapist_leaves WHERE therapist_id=? AND date=?').get(tid, date);
  if (exists) return res.status(409).json({ error: '该日期已登记请假' });
  db.prepare('INSERT INTO therapist_leaves(id,therapist_id,date,reason) VALUES(?,?,?,?)')
    .run(uid(), tid, date, reason || '');
  const tname = db.prepare('SELECT name FROM users WHERE id=?').get(tid)?.name || '治疗师';
  const affected = db.prepare(`SELECT * FROM appointments WHERE therapist_id=? AND date=?
    AND status IN ('scheduled','arrived')`).all(tid, date);
  let eventId = null;
  if (affected.length) {
    eventId = createEvent({
      type: 'therapist_leave',
      title: `${tname} ${date} 临时请假，${affected.length} 个预约待处理`,
      detail: { date, reason: reason || '', appointmentIds: affected.map((a) => a.id) },
      user: req.user,
    });
  }
  return res.json({ ok: true, affected: affected.length, eventId });
});

/* ---------- 器械状态变更（消毒/维护/故障/恢复） ---------- */
router.post('/equipment/:id/status', authRequired, requireRole('maintenance', 'frontdesk'), (req, res) => {
  const { status, note } = req.body || {};
  const allowed = ['available', 'disinfecting', 'maintenance', 'fault'];
  if (!allowed.includes(status)) return res.status(400).json({ error: '非法状态' });
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '器械不存在' });
  const fields = ['status=?', 'note=?'];
  const vals = [status, note ?? eq.note ?? ''];
  if (status === 'available') { fields.push('last_disinfected_at=?'); vals.push(nowIso()); }
  db.prepare(`UPDATE equipment SET ${fields.join(', ')} WHERE id=?`).run(...vals, eq.id);

  let eventId = null;
  if (status === 'fault') {
    const affected = db.prepare(`SELECT * FROM appointments WHERE equipment_id=? AND date>=date('now','localtime')
      AND status IN ('scheduled','arrived')`).all(eq.id);
    eventId = createEvent({
      type: 'equipment_fault', equipmentId: eq.id,
      title: `器械「${eq.name}」故障，${affected.length} 个预约受影响`,
      detail: { note: note || '', appointmentIds: affected.map((a) => a.id) },
      user: req.user,
    });
  }
  if (eq.status === 'fault' && status === 'available') {
    // 故障修复：自动在相关未结事件中留痕
    const open = db.prepare(`SELECT * FROM events WHERE equipment_id=? AND type='equipment_fault' AND status!='resolved'`).all(eq.id);
    for (const ev of open) addStep(ev.id, req.user, '修复完成', note || '器械已恢复可用');
  }
  return res.json({ ok: true, eventId });
});

export default router;
