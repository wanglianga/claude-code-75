import { Router } from 'express';
import db, {
  mapPatient, mapEquipment, mapPlan, mapAppointment, mapEvent, mapStep, mapEscalation,
  mapConfirmation, mapBilling, mapMaintenanceOrder, mapReconfirmation, J,
} from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { CATEGORIES, EVENT_TYPES, ROLE_LABELS, EQUIPMENT_TYPES } from '../domain/population.js';
import { createEvent, addStep, openOrderOfEquipment } from '../helpers.js';
import { uid, nowIso, todayStr } from '../util.js';

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

  const confBase = `SELECT ic.*, p.name patient_name FROM insurance_confirmations ic
    JOIN patients p ON p.id=ic.patient_id`;
  const confirmations = scoped
    ? db.prepare(`${confBase} WHERE ic.patient_id=? ORDER BY ic.created_at DESC`).all(pid)
    : db.prepare(`${confBase} ORDER BY ic.created_at DESC`).all();

  const billBase = 'SELECT b.*, p.name patient_name FROM billing_records b JOIN patients p ON p.id=b.patient_id';
  const billing = scoped
    ? db.prepare(`${billBase} WHERE b.patient_id=? ORDER BY b.created_at DESC`).all(pid)
    : db.prepare(`${billBase} ORDER BY b.created_at DESC`).all();

  const recBase = `SELECT rc.*, p.name patient_name,
      ef.name from_equipment_name, et.name to_equipment_name, a.date appt_date, a.start appt_start
    FROM plan_reconfirmations rc
    JOIN patients p ON p.id=rc.patient_id
    LEFT JOIN equipment ef ON ef.id=rc.from_equipment_id
    LEFT JOIN equipment et ON et.id=rc.to_equipment_id
    LEFT JOIN appointments a ON a.id=rc.appointment_id`;
  const reconfirmations = scoped
    ? db.prepare(`${recBase} WHERE rc.patient_id=? ORDER BY rc.created_at DESC`).all(pid)
    : db.prepare(`${recBase} ORDER BY rc.created_at DESC`).all();

  const maintenanceOrders = db.prepare(`SELECT mo.*, e.name equipment_name, e.type equipment_type
    FROM maintenance_orders mo JOIN equipment e ON e.id=mo.equipment_id ORDER BY mo.created_at DESC`).all();

  res.json({
    patients: patients.map(mapPatient),
    appointments: appointments.map(mapAppointment),
    events: eventRows.map((e) => mapEvent(e, stepsByEvent[e.id] || [])),
    escalations: escalations.map(mapEscalation),
    equipment: db.prepare('SELECT * FROM equipment ORDER BY name').all().map(mapEquipment),
    plans: plans.map(mapPlan),
    therapists: therapistsInfo(),
    confirmations: confirmations.map(mapConfirmation),
    billing: billing.map(mapBilling),
    reconfirmations: reconfirmations.map(mapReconfirmation),
    maintenanceOrders: maintenanceOrders.map(mapMaintenanceOrder),
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

/* ---------- 器械影响分析：受影响预约 / 替代器械（标注效果异同） / 维修工单 / 消毒状态 ---------- */
function impactOf(eq) {
  const affected = db.prepare(`SELECT a.*, p.name patient_name, t.name therapist_name, e.name equipment_name
    FROM appointments a
    JOIN patients p ON p.id=a.patient_id
    LEFT JOIN users t ON t.id=a.therapist_id
    JOIN equipment e ON e.id=a.equipment_id
    WHERE a.equipment_id=? AND a.date>=? AND a.status IN ('scheduled','arrived','pending_reconfirm')
    ORDER BY a.date, a.start`).all(eq.id, todayStr());
  const alternatives = db.prepare("SELECT * FROM equipment WHERE id!=? AND status='available' ORDER BY name").all(eq.id)
    .map((alt) => ({
      ...mapEquipment(alt),
      sameEffect: (eq.effect_group || '') !== '' && alt.effect_group === eq.effect_group,
    }));
  const order = openOrderOfEquipment(eq.id);
  return {
    equipment: mapEquipment(eq),
    affected: affected.map(mapAppointment),
    alternatives,
    order: order ? mapMaintenanceOrder(order) : null,
  };
}

router.get('/equipment/:id/impact', authRequired, (req, res) => {
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '器械不存在' });
  return res.json(impactOf(eq));
});

/* ---------- 器械故障上报（阻力异常等）：停用 + 维修工单 + 受影响预约/替代器械 ---------- */
router.post('/equipment/:id/report-issue', authRequired, requireRole('maintenance', 'frontdesk'), (req, res) => {
  const { issueType, description } = req.body || {};
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: '器械不存在' });
  const type = String(issueType || '阻力异常').trim().slice(0, 30) || '阻力异常';
  db.prepare("UPDATE equipment SET status='fault', note=? WHERE id=?")
    .run(`${type}：${description || '待检修'}（停用维修）`, eq.id);

  let order = openOrderOfEquipment(eq.id);
  if (!order) {
    const oid = uid();
    db.prepare(`INSERT INTO maintenance_orders(id,equipment_id,issue_type,description,status,disinfection_status,reported_by,created_at)
      VALUES(?,?,?,?,'open','pending',?,?)`).run(oid, eq.id, type, description || '', req.user.name, nowIso());
    order = db.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(oid);
  }
  const impact = impactOf(eq);
  const eventId = createEvent({
    type: 'equipment_fault', equipmentId: eq.id,
    title: `器械「${eq.name}」${type}，已停用维修，${impact.affected.length} 个预约受影响`,
    detail: {
      orderId: order.id, issueType: type, note: description || '',
      appointmentIds: impact.affected.map((a) => a.id),
      disinfectionStatus: order.disinfection_status,
    },
    user: req.user,
  });
  return res.json({ ok: true, eventId, ...impact });
});

/* ---------- 维修工单列表 ---------- */
router.get('/maintenance/orders', authRequired, (req, res) => {
  const rows = db.prepare(`SELECT mo.*, e.name equipment_name, e.type equipment_type
    FROM maintenance_orders mo JOIN equipment e ON e.id=mo.equipment_id ORDER BY mo.created_at DESC`).all();
  res.json({ orders: rows.map(mapMaintenanceOrder) });
});

/* ---------- 工单流转：开始维修 / 维修完成 / 消毒完成（双完成后器械恢复可用） ---------- */
router.patch('/maintenance/orders/:id', authRequired, requireRole('maintenance', 'frontdesk'), (req, res) => {
  const o = db.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: '工单不存在' });
  const { status, disinfectionStatus } = req.body || {};
  const allowedStatus = ['open', 'repairing', 'resolved'];
  const newStatus = status === undefined ? o.status : status;
  const newDis = disinfectionStatus === undefined ? o.disinfection_status : disinfectionStatus;
  if (!allowedStatus.includes(newStatus)) return res.status(400).json({ error: '非法工单状态' });
  if (!['pending', 'done'].includes(newDis)) return res.status(400).json({ error: '非法消毒状态' });
  const resolvedAt = newStatus === 'resolved' ? (o.resolved_at || nowIso()) : null;
  db.prepare('UPDATE maintenance_orders SET status=?, disinfection_status=?, updated_at=?, resolved_at=? WHERE id=?')
    .run(newStatus, newDis, nowIso(), resolvedAt, o.id);

  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(o.equipment_id);
  const openEvents = db.prepare("SELECT * FROM events WHERE equipment_id=? AND type='equipment_fault' AND status!='resolved'")
    .all(o.equipment_id);
  if (newStatus === 'repairing' && o.status !== 'repairing') {
    for (const ev of openEvents) addStep(ev.id, req.user, '开始维修', `工单进入维修中（${o.issue_type}）`);
  }
  if (newStatus === 'resolved' && o.status !== 'resolved') {
    for (const ev of openEvents) addStep(ev.id, req.user, '维修完成', `「${eq?.name}」${o.issue_type}已修复`);
  }
  if (newDis === 'done' && o.disinfection_status !== 'done') {
    for (const ev of openEvents) addStep(ev.id, req.user, '消毒完成', '器械已完成消毒');
  }
  // 维修 + 消毒双完成 → 器械恢复可用
  if (newStatus === 'resolved' && newDis === 'done') {
    db.prepare("UPDATE equipment SET status='available', last_disinfected_at=?, note='' WHERE id=?").run(nowIso(), o.equipment_id);
    for (const ev of openEvents) addStep(ev.id, req.user, '恢复可用', '维修与消毒均完成，器械恢复可用；受影响预约请前台确认改约情况');
  }
  const row = db.prepare(`SELECT mo.*, e.name equipment_name, e.type equipment_type
    FROM maintenance_orders mo JOIN equipment e ON e.id=mo.equipment_id WHERE mo.id=?`).get(o.id);
  return res.json({ ok: true, order: mapMaintenanceOrder(row) });
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
    // 无工单时补建工单（与 report-issue 保持一致）
    let order = openOrderOfEquipment(eq.id);
    if (!order) {
      const oid = uid();
      db.prepare(`INSERT INTO maintenance_orders(id,equipment_id,issue_type,description,status,disinfection_status,reported_by,created_at)
        VALUES(?,?,?,?,'open','pending',?,?)`).run(oid, eq.id, '故障', note || '', req.user.name, nowIso());
      order = db.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(oid);
    }
    const affected = db.prepare(`SELECT * FROM appointments WHERE equipment_id=? AND date>=date('now','localtime')
      AND status IN ('scheduled','arrived','pending_reconfirm')`).all(eq.id);
    eventId = createEvent({
      type: 'equipment_fault', equipmentId: eq.id,
      title: `器械「${eq.name}」故障，${affected.length} 个预约受影响`,
      detail: { note: note || '', orderId: order.id, appointmentIds: affected.map((a) => a.id) },
      user: req.user,
    });
  }
  if (eq.status === 'fault' && status === 'available') {
    // 故障修复：自动在相关未结事件中留痕，并闭环工单
    const open = db.prepare(`SELECT * FROM events WHERE equipment_id=? AND type='equipment_fault' AND status!='resolved'`).all(eq.id);
    for (const ev of open) addStep(ev.id, req.user, '修复完成', note || '器械已恢复可用');
    const order = openOrderOfEquipment(eq.id);
    if (order) {
      db.prepare("UPDATE maintenance_orders SET status='resolved', disinfection_status='done', updated_at=?, resolved_at=? WHERE id=?")
        .run(nowIso(), nowIso(), order.id);
    }
  }
  return res.json({ ok: true, eventId });
});

export default router;
