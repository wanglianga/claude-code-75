import { Router } from 'express';
import db, { mapPatient, mapConfirmation, J } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { generateSlots, therapistAvailable, overlaps } from '../domain/slots.js';
import { evaluateCheckin, evaluateSession, riskTipsFor } from '../domain/risk.js';
import { CATEGORIES } from '../domain/population.js';
import {
  createEvent, addStep, getPatient, getAppointmentRow, getAppointment,
  activePlanOf, lastCompletedOf, autoStepForAppointment, pendingEscalationOf,
  ensureInsuranceConfirmation, selfPayInfoOf, INSURANCE_WARN_THRESHOLD,
} from '../helpers.js';
import { acknowledgeEscalation } from './pain.js';
import { uid, nowIso, todayStr, addDays } from '../util.js';

const router = Router();
router.use(authRequired);

const ACTIVE = "('scheduled','arrived','in_progress','pending_reconfirm')";

function loadSlotContext(patientId, equipmentId) {
  const patient = getPatient(patientId);
  if (!patient) return { error: [404, '患者不存在'] };
  const equipment = db.prepare('SELECT * FROM equipment WHERE id=?').get(equipmentId);
  if (!equipment) return { error: [404, '器械不存在'] };
  const therapistId = patient.therapistId;
  if (!therapistId) return { error: [400, '患者尚未分配负责治疗师'] };
  const from = todayStr();
  const to = addDays(from, 14);
  return {
    patient, equipment, therapistId,
    schedules: db.prepare('SELECT * FROM schedules WHERE therapist_id=?').all(therapistId),
    leaves: db.prepare('SELECT * FROM therapist_leaves WHERE therapist_id=?').all(therapistId),
    appointments: db.prepare(`SELECT * FROM appointments WHERE date>=? AND date<=? AND status IN ${ACTIVE}
      AND (therapist_id=? OR equipment_id=?)`).all(from, to, therapistId, equipmentId),
    escalations: db.prepare('SELECT * FROM pain_escalations WHERE patient_id=? ORDER BY created_at DESC').all(patientId),
  };
}

/* ---------- 可预约时段生成 ---------- */
router.post('/slots', (req, res) => {
  const { patientId, equipmentId, duration } = req.body || {};
  const ctx = loadSlotContext(patientId, equipmentId);
  if (ctx.error) return res.status(ctx.error[0]).json({ error: ctx.error[1] });
  const last = lastCompletedOf(patientId);
  const lastFeedback = last ? { ...(J(last.feedback, {}) || {}), date: last.date } : null;
  const result = generateSlots({
    patient: ctx.patient,
    equipment: { ...ctx.equipment, suitableCategories: J(ctx.equipment.suitable_categories, []) },
    therapistId: ctx.therapistId,
    schedules: ctx.schedules,
    leaves: ctx.leaves,
    appointments: ctx.appointments,
    escalations: ctx.escalations,
    lastFeedback,
    duration: duration ? Number(duration) : undefined,
  });
  // 医保次数不足提示：预约时即将用尽则确保确认单存在（页面展示剩余次数/自费价格/医生建议/家属确认）
  const ins = selfPayInfoOf(ctx.patient);
  let confirmation = null;
  if (ins.item && ins.remaining <= INSURANCE_WARN_THRESHOLD) {
    confirmation = ensureInsuranceConfirmation(patientId, req.user);
  }
  return res.json({
    ...result,
    insurance: {
      item: ins.item || null, remaining: ins.remaining, selfPayRemaining: ins.selfPayRemaining,
      confirmation: confirmation ? mapConfirmation(confirmation) : null,
    },
  });
});

/* ---------- 创建预约 ---------- */
router.post('/', requireRole('frontdesk', 'therapist', 'patient'), (req, res) => {
  const { patientId, equipmentId, date, start, duration } = req.body || {};
  if (!patientId || !equipmentId || !date || !start) return res.status(400).json({ error: '缺少预约参数' });
  const patient = getPatient(patientId);
  if (!patient) return res.status(404).json({ error: '患者不存在' });
  if (req.user.role === 'patient' && req.user.patient_id !== patientId) return res.status(403).json({ error: '只能为本人预约' });
  if (patient.status !== 'active') return res.status(400).json({ error: '患者当前处于暂停/转诊状态，不可预约' });
  const equipment = db.prepare('SELECT * FROM equipment WHERE id=?').get(equipmentId);
  if (!equipment) return res.status(404).json({ error: '器械不存在' });
  if (equipment.status !== 'available') return res.status(409).json({ error: '器械当前不可用，请选择其他器械或时段' });
  const therapistId = patient.therapistId;
  if (!therapistId) return res.status(400).json({ error: '患者尚未分配负责治疗师' });
  const dur = Number(duration) || (CATEGORIES[patient.category] || {}).defaultDuration || 45;

  // 治疗师排班/请假/冲突校验
  const schedules = db.prepare('SELECT * FROM schedules WHERE therapist_id=?').all(therapistId);
  const leaves = db.prepare('SELECT * FROM therapist_leaves WHERE therapist_id=?').all(therapistId);
  const dayAppts = db.prepare(`SELECT * FROM appointments WHERE date=? AND status IN ${ACTIVE}
    AND (therapist_id=? OR equipment_id=?)`).all(date, therapistId, equipmentId);
  if (!therapistAvailable({ therapistId, date, start, duration: dur, schedules, leaves, appointments: dayAppts })) {
    return res.status(409).json({ error: '该时段不可用（治疗师请假/排班外/时间冲突），请重新选择' });
  }
  if (dayAppts.some((a) => a.equipment_id === equipmentId && overlaps(start, dur, a.start, a.duration))) {
    return res.status(409).json({ error: '该器械此时段已被预约' });
  }

  // 医保次数：即将用尽触发确认流；已用尽需家属确认自费后凭自费额度预约
  const ins = selfPayInfoOf(patient);
  let payType = 'insurance';
  let confirmation = null;
  if (ins.item) {
    if (ins.remaining <= 0) {
      if (ins.selfPayRemaining > 0) {
        payType = 'self_pay';
      } else {
        ensureInsuranceConfirmation(patientId, req.user);
        return res.status(409).json({
          error: `医保项目「${ins.item.name}」次数已用完：需医生续开建议 → 家属确认自费后，方可按自费继续预约`,
          code: 'INSURANCE_SHORTAGE',
        });
      }
    } else if (ins.remaining <= INSURANCE_WARN_THRESHOLD) {
      confirmation = ensureInsuranceConfirmation(patientId, req.user);
    }
  }

  const plan = activePlanOf(patientId);
  const id = uid();
  const snapshot = { riskLevel: patient.riskLevel, tips: riskTipsFor(patient) };
  db.prepare(`INSERT INTO appointments(id,patient_id,therapist_id,equipment_id,plan_id,insurance_item,date,start,duration,status,pay_type,risk_snapshot,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,'scheduled',?,?,?)`)
    .run(id, patientId, therapistId, equipmentId, plan ? plan.id : null, ins.item ? ins.item.name : null,
      date, start, dur, payType, JSON.stringify(snapshot), nowIso());
  return res.json({
    appointment: getAppointment(id),
    payType,
    insuranceWarning: confirmation ? mapConfirmation(confirmation) : null,
  });
});

/* ---------- 到场登记（前台） ---------- */
router.post('/:id/arrive', requireRole('frontdesk', 'therapist'), (req, res) => {
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (a.status !== 'scheduled') return res.status(409).json({ error: '当前状态不可登记到场' });
  db.prepare("UPDATE appointments SET status='arrived' WHERE id=?").run(a.id);
  return res.json({ appointment: getAppointment(a.id) });
});

/* ---------- 迟到处理（前台） ---------- */
router.post('/:id/late', requireRole('frontdesk'), (req, res) => {
  const { action, note } = req.body || {}; // action: shorten | rebook
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (!['scheduled', 'arrived'].includes(a.status)) return res.status(409).json({ error: '当前状态不可标记迟到' });
  const patient = getPatient(a.patient_id);
  db.prepare('UPDATE appointments SET late=1 WHERE id=?').run(a.id);
  if (action === 'rebook') {
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(a.id);
  }
  createEvent({
    patientId: a.patient_id, appointmentId: a.id, planId: a.plan_id, type: 'late',
    title: `${patient.name} ${a.date} ${a.start} 训练迟到`,
    detail: { action: action || 'shorten', note: note || '', rebook: action === 'rebook' },
    user: req.user,
  });
  return res.json({ ok: true });
});

/* ---------- 取消预约 ---------- */
router.post('/:id/cancel', requireRole('frontdesk', 'therapist', 'patient'), (req, res) => {
  const { reason } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (req.user.role === 'patient' && req.user.patient_id !== a.patient_id) return res.status(403).json({ error: '只能取消本人预约' });
  if (!['scheduled', 'arrived'].includes(a.status)) return res.status(409).json({ error: '当前状态不可取消' });
  const fb = { ...(J(a.feedback, {}) || {}), cancelReason: reason || '', cancelledBy: req.user.name, cancelledAt: nowIso() };
  db.prepare("UPDATE appointments SET status='cancelled', feedback=? WHERE id=?").run(JSON.stringify(fb), a.id);
  return res.json({ ok: true });
});

/* ---------- 到场核验并开始训练（治疗师） ---------- */
router.post('/:id/checkin', requireRole('therapist'), (req, res) => {
  const { vitals = {}, fit, confirms = {}, handoverAck = false } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (!['arrived', 'scheduled'].includes(a.status)) return res.status(409).json({ error: '当前状态不可核验' });
  const patient = getPatient(a.patient_id);

  // 疼痛升级交班：下一次训练不会只看预约状态——必须先阅读并知悉上一位治疗师的交班（中止原因/患者主诉/医生建议）
  const pending = pendingEscalationOf(a.patient_id);
  if (pending && !handoverAck) {
    return res.status(400).json({
      error: '该患者存在未交班知悉的疼痛升级事件，请先阅读交班记录（疼痛变化、患者主诉、中止原因、医生建议）并确认知悉后再开始训练',
      code: 'HANDOVER_REQUIRED',
      handover: {
        id: pending.id,
        painBefore: pending.pain_before, painPeak: pending.pain_peak, painChange: pending.pain_change,
        patientWords: pending.patient_words, actionAngle: pending.action_angle,
        doctorAdvice: pending.doctor_advice, nextIntensity: pending.next_intensity,
        nextIntervalDays: pending.next_interval_days, createdAt: pending.created_at,
      },
    });
  }

  // 高风险患者：训练前必须确认医嘱、家属知情、紧急联系人
  if (patient.riskLevel === '高') {
    const missing = [];
    if (!confirms.doctor) missing.push('医生医嘱确认');
    if (!confirms.family) missing.push('家属知情确认');
    if (!confirms.emergency) missing.push('紧急联系人确认');
    if (missing.length) return res.status(400).json({ error: `高风险患者需先完成：${missing.join('、')}` });
  }

  const issues = evaluateCheckin(patient, vitals);
  const checkin = {
    ...vitals, fit: !!fit, issues, confirms,
    familyConsentOnline: !!a.family_consent, at: nowIso(), by: req.user.name,
  };
  if (!fit) {
    db.prepare("UPDATE appointments SET status='cancelled', checkin=? WHERE id=?").run(JSON.stringify(checkin), a.id);
    createEvent({
      patientId: a.patient_id, appointmentId: a.id, planId: a.plan_id, type: 'checkin_unfit',
      title: `${patient.name} 到场核验不适合当天训练`,
      detail: { issues, note: vitals.notes || '', rebook: true },
      user: req.user,
    });
    return res.json({ ok: true, fit: false, issues });
  }
  db.prepare("UPDATE appointments SET status='in_progress', checkin=? WHERE id=?").run(JSON.stringify(checkin), a.id);
  // 核验通过、正式开始训练：完成疼痛升级交班知悉闭环
  if (pending) acknowledgeEscalation(pending.id, req.user, req.body?.handoverNote || '');
  return res.json({ ok: true, fit: true, issues });
});

/* ---------- 训练中记录（可多次保存，返回实时告警） ---------- */
router.post('/:id/session', requireRole('therapist'), (req, res) => {
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (a.status !== 'in_progress') return res.status(409).json({ error: '仅训练中可记录' });
  const patient = getPatient(a.patient_id);
  const session = { ...(J(a.session, {}) || {}), ...(req.body || {}).session, updatedAt: nowIso(), by: req.user.name };
  db.prepare('UPDATE appointments SET session=? WHERE id=?').run(JSON.stringify(session), a.id);
  return res.json({ ok: true, alerts: evaluateSession(patient, session) });
});

/* ---------- 异常中止 ---------- */
router.post('/:id/abort', requireRole('therapist'), (req, res) => {
  const { reason } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (a.status !== 'in_progress') return res.status(409).json({ error: '仅训练中可中止' });
  const patient = getPatient(a.patient_id);
  const session = { ...(J(a.session, {}) || {}), aborted: true, abortReason: reason || '' };
  db.prepare("UPDATE appointments SET status='aborted', session=? WHERE id=?").run(JSON.stringify(session), a.id);
  createEvent({
    patientId: a.patient_id, appointmentId: a.id, planId: a.plan_id, type: 'abort',
    title: `${patient.name} 训练中异常中止`,
    detail: { reason: reason || '', note: reason || '' },
    user: req.user,
  });
  return res.json({ ok: true });
});

/* ---------- 完成训练（记录+疗效反馈+器械消毒+下次建议） ---------- */
router.post('/:id/complete', requireRole('therapist'), (req, res) => {
  const { session: s, feedback: f = {} } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (a.status !== 'in_progress') return res.status(409).json({ error: '仅训练中可完成' });
  const patient = getPatient(a.patient_id);

  // 疼痛升级交班闭环：本次训练正常完成，自动确认交班知悉（按降级建议执行且未再升级）
  const stillEscalated = (J(a.session, {}) || {}).painEscalation;
  const pendingBeforeComplete = pendingEscalationOf(a.patient_id);
  if (pendingBeforeComplete && (!stillEscalated || stillEscalated.id !== pendingBeforeComplete.id)) {
    acknowledgeEscalation(pendingBeforeComplete.id, req.user, '本次训练正常完成，已按疼痛升级后的降级强度执行');
  }

  if (s) {
    const session = { ...(J(a.session, {}) || {}), ...s, updatedAt: nowIso(), by: req.user.name };
    db.prepare('UPDATE appointments SET session=? WHERE id=?').run(JSON.stringify(session), a.id);
  }
  const feedback = { ...f, at: nowIso(), by: req.user.name };
  db.prepare("UPDATE appointments SET status='completed', feedback=? WHERE id=?").run(JSON.stringify(feedback), a.id);

  // 医保/自费次数核销
  if (a.pay_type === 'self_pay') {
    const items = (patient.insuranceItems || []).map((it) => (it.name === a.insurance_item
      ? { ...it, selfPayUsed: (it.selfPayUsed || 0) + 1 } : it));
    db.prepare('UPDATE patients SET insurance_items=? WHERE id=?').run(JSON.stringify(items), patient.id);
  } else if (a.insurance_item) {
    const items = patient.insuranceItems.map((it) => (it.name === a.insurance_item && it.used < it.total
      ? { ...it, used: it.used + 1 } : it));
    db.prepare('UPDATE patients SET insurance_items=? WHERE id=?').run(JSON.stringify(items), patient.id);
  }
  // 核销后若医保即将用尽 → 触发确认流（医生续开建议/家属确认）
  const warning = ensureInsuranceConfirmation(a.patient_id, req.user);
  // 器械进入消毒
  db.prepare("UPDATE equipment SET status='disinfecting' WHERE id=? AND status='available'").run(a.equipment_id);

  // 训练后疼痛加重 → 协同事件
  const eventsCreated = [];
  if ((f.painAfter ?? 0) >= 6) {
    eventsCreated.push(createEvent({
      patientId: a.patient_id, appointmentId: a.id, planId: a.plan_id, type: 'pain_aggravation',
      title: `${patient.name} 训练后疼痛加重（${f.painAfter}分）`,
      detail: { painAfter: f.painAfter, note: f.note || '', followup: true },
      user: req.user,
    }));
  }
  const cfg = CATEGORIES[patient.category] || {};
  const interval = Math.max(f.nextIntervalDays || 0, cfg.minIntervalDays || 1, (f.painAfter ?? 0) >= 6 ? 3 : 0);
  const nextSuggestion = { date: addDays(todayStr(), interval), duration: a.duration };
  const alerts = evaluateSession(patient, { ...(J(a.session, {}) || {}), ...(s || {}) });
  return res.json({
    ok: true, alerts, eventsCreated, nextSuggestion,
    insuranceWarning: warning ? mapConfirmation(warning) : null,
  });
});

/* ---------- 改派治疗师（前台：应对请假等） ---------- */
router.post('/:id/reassign', requireRole('frontdesk'), (req, res) => {
  const { therapistId } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (!['scheduled', 'arrived'].includes(a.status)) return res.status(409).json({ error: '当前状态不可改派' });
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role='therapist'").get(therapistId);
  if (!t) return res.status(404).json({ error: '治疗师不存在' });
  const schedules = db.prepare('SELECT * FROM schedules WHERE therapist_id=?').all(therapistId);
  const leaves = db.prepare('SELECT * FROM therapist_leaves WHERE therapist_id=?').all(therapistId);
  const dayAppts = db.prepare(`SELECT * FROM appointments WHERE date=? AND status IN ${ACTIVE} AND therapist_id=? AND id!=?`)
    .all(a.date, therapistId, a.id);
  if (!therapistAvailable({ therapistId, date: a.date, start: a.start, duration: a.duration, schedules, leaves, appointments: dayAppts })) {
    return res.status(409).json({ error: `${t.name} 在该时段不可用（排班外/请假/冲突）` });
  }
  db.prepare('UPDATE appointments SET therapist_id=? WHERE id=?').run(therapistId, a.id);
  autoStepForAppointment(a.id, ['therapist_leave'], req.user, '改派治疗师', `已改派给 ${t.name}`);
  return res.json({ appointment: getAppointment(a.id) });
});

/* ---------- 改约（器械停用后）：同效果器械可直接平移；效果不同须治疗师重新确认 ---------- */
router.post('/:id/reschedule', requireRole('frontdesk'), (req, res) => {
  const { equipmentId, date, start } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (!['scheduled', 'arrived', 'pending_reconfirm'].includes(a.status)) {
    return res.status(409).json({ error: '当前状态不可改约' });
  }
  const newEqId = equipmentId || a.equipment_id;
  const newDate = date || a.date;
  const newStart = start || a.start;
  const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(newEqId);
  if (!eq) return res.status(404).json({ error: '器械不存在' });
  if (eq.status !== 'available') return res.status(409).json({ error: `器械「${eq.name}」当前不可用，无法改约到该器械` });
  const patient = getPatient(a.patient_id);

  // 时段冲突校验（治疗师排班/请假 + 器械占用）
  const schedules = db.prepare('SELECT * FROM schedules WHERE therapist_id=?').all(a.therapist_id);
  const leaves = db.prepare('SELECT * FROM therapist_leaves WHERE therapist_id=?').all(a.therapist_id);
  const dayAppts = db.prepare(`SELECT * FROM appointments WHERE date=? AND status IN ${ACTIVE} AND id!=?
    AND (therapist_id=? OR equipment_id=?)`).all(newDate, a.id, a.therapist_id, newEqId);
  if (!therapistAvailable({ therapistId: a.therapist_id, date: newDate, start: newStart, duration: a.duration, schedules, leaves, appointments: dayAppts })) {
    return res.status(409).json({ error: '该时段治疗师不可用（排班外/请假/冲突）' });
  }
  if (dayAppts.some((x) => x.equipment_id === newEqId && overlaps(newStart, a.duration, x.start, x.duration))) {
    return res.status(409).json({ error: '替代器械此时段已被预约' });
  }

  const oldEq = db.prepare('SELECT * FROM equipment WHERE id=?').get(a.equipment_id);
  const sameEffect = newEqId === a.equipment_id
    || ((oldEq.effect_group || '') !== '' && oldEq.effect_group === eq.effect_group);

  if (sameEffect) {
    // 训练效果相同：前台可直接平移预约
    db.prepare("UPDATE appointments SET equipment_id=?, date=?, start=?, status='scheduled' WHERE id=?")
      .run(newEqId, newDate, newStart, a.id);
    db.prepare("UPDATE plan_reconfirmations SET status='cancelled' WHERE appointment_id=? AND status='pending'").run(a.id);
    autoStepForAppointment(a.id, ['equipment_fault'], req.user, '改约器械',
      `已改约至「${eq.name}」（${newDate} ${newStart}）：训练效果相同，直接平移`);
    return res.json({ appointment: getAppointment(a.id), reconfirm: false });
  }

  // 训练效果不同：前台不能简单平移 → 生成计划重确认，预约挂起待治疗师确认
  db.prepare("UPDATE plan_reconfirmations SET status='cancelled' WHERE appointment_id=? AND status='pending'").run(a.id);
  const plan = activePlanOf(a.patient_id);
  const recId = uid();
  db.prepare(`INSERT INTO plan_reconfirmations(id,patient_id,plan_id,appointment_id,from_equipment_id,to_equipment_id,reason,status,
    old_goals,old_rom,old_estimated_sessions,old_patient_reminder,created_at)
    VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?,?)`).run(
    recId, a.patient_id, plan ? plan.id : null, a.id, a.equipment_id, newEqId,
    `原器械「${oldEq.name}」停用，替代器械「${eq.name}」训练效果不同（${oldEq.effect_desc || oldEq.effect_group || '—'} → ${eq.effect_desc || eq.effect_group || '—'}），需重新确认训练目标与动作范围`,
    plan ? plan.goals : '', plan ? (plan.rom || '') : '', plan ? plan.estimated_sessions : null,
    plan ? (plan.patient_reminder || '') : '', nowIso(),
  );
  db.prepare("UPDATE appointments SET equipment_id=?, date=?, start=?, status='pending_reconfirm' WHERE id=?")
    .run(newEqId, newDate, newStart, a.id);
  createEvent({
    patientId: a.patient_id, appointmentId: a.id, planId: plan ? plan.id : null, equipmentId: newEqId,
    type: 'plan_reconfirm',
    title: `${patient.name} 改约至「${eq.name}」：训练效果不同，待治疗师重新确认`,
    detail: {
      reconfirmationId: recId, fromEquipment: oldEq.name, toEquipment: eq.name,
      fromEffect: oldEq.effect_desc || oldEq.effect_group || '—', toEffect: eq.effect_desc || eq.effect_group || '—',
      note: `替代器械训练效果不同，治疗师需重新确认训练目标与动作范围；确认前预约不可执行（前台不能简单平移）`,
    },
    user: req.user,
  });
  autoStepForAppointment(a.id, ['equipment_fault'], req.user, '改约器械',
    `已改约至「${eq.name}」（${newDate} ${newStart}）：训练效果不同，待治疗师重新确认`);
  return res.json({
    appointment: getAppointment(a.id), reconfirm: true,
    message: '替代器械训练效果不同：已挂起预约并提交治疗师重新确认（目标/动作范围确认前不可执行）',
  });
});

/* ---------- 家属在线知情确认（高风险） ---------- */
router.post('/:id/family-consent', requireRole('family'), (req, res) => {
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (req.user.patient_id !== a.patient_id) return res.status(403).json({ error: '仅可为关联患者确认' });
  db.prepare('UPDATE appointments SET family_consent=1 WHERE id=?').run(a.id);
  return res.json({ ok: true });
});

/* ---------- 患者延迟疼痛反馈（训练后） ---------- */
router.post('/:id/delayed-pain', requireRole('patient'), (req, res) => {
  const { pain, note } = req.body || {};
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (req.user.patient_id !== a.patient_id) return res.status(403).json({ error: '仅可反馈本人训练' });
  if (a.status !== 'completed') return res.status(409).json({ error: '仅已完成训练可反馈' });
  const fb = J(a.feedback, {}) || {};
  if (fb.delayedPain) return res.status(409).json({ error: '该次训练已提交过延迟疼痛反馈' });
  const p = Number(pain);
  if (!(p >= 0 && p <= 10)) return res.status(400).json({ error: '疼痛评分需为0-10' });
  fb.delayedPain = { pain: p, note: note || '', at: nowIso() };
  db.prepare('UPDATE appointments SET feedback=? WHERE id=?').run(JSON.stringify(fb), a.id);
  const patient = getPatient(a.patient_id);
  const followup = p >= 6;
  createEvent({
    patientId: a.patient_id, appointmentId: a.id, planId: a.plan_id, type: 'delayed_pain',
    title: `${patient.name} 训练后延迟疼痛 ${p} 分${followup ? '，建议复诊' : ''}`,
    detail: { pain: p, note: note || '', followup, date: a.date },
    user: req.user,
  });
  return res.json({ ok: true, followup });
});

export default router;
