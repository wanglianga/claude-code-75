import { Router } from 'express';
import db, { mapEscalation, J } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { getAppointmentRow, getPatientRow, getPatient, createEvent, addStep } from '../helpers.js';
import { classifyPain, immediateActions, nextTrainingPlan, mergeRiskTags } from '../domain/pain.js';
import { uid, nowIso } from '../util.js';

const router = Router();
router.use(authRequired);

/* ---------- 训练中疼痛升级：暂停 / 记录角度 / 冰敷 / 通知医生 ---------- */
router.post('/appointments/:id/pain-escalation', requireRole('therapist'), (req, res) => {
  const a = getAppointmentRow(req.params.id);
  if (!a) return res.status(404).json({ error: '预约不存在' });
  if (a.status !== 'in_progress') return res.status(409).json({ error: '仅训练中可记录疼痛升级' });
  const patientRow = getPatientRow(a.patient_id);
  const patient = getPatient(a.patient_id);
  const b = req.body || {};

  const checkinPain = J(a.checkin, {})?.pain;
  const before = Number(b.painBefore ?? checkinPain ?? patient.painScore);
  const peak = Number(b.painPeak);
  if (!(peak >= 0 && peak <= 10)) return res.status(400).json({ error: '疼痛峰值需为 0-10' });
  if (!(before >= 0 && before <= 10)) return res.status(400).json({ error: '训练前疼痛评分需为 0-10' });
  if (peak < before) return res.status(400).json({ error: '疼痛升级要求峰值不低于训练前评分（普通波动请写入训练记录）' });

  const change = peak - before;
  const cls = classifyPain({ before, peak, change });
  const words = String(b.patientWords || '').slice(0, 200);
  const angle = String(b.actionAngle || '').slice(0, 60);
  const actions = b.actions || {};
  const suggestion = nextTrainingPlan({ before, peak, change, actionAngle: angle, category: patient.category });

  // 治疗师可调整系统给出的下次强度/间隔建议
  const nextIntensity = String(b.nextIntensity || suggestion.intensity).slice(0, 300);
  const nextIntervalDays = Math.max(1, Math.min(14, Number(b.nextIntervalDays ?? suggestion.intervalDays) || suggestion.intervalDays));
  const notifyFamily = b.notifyFamily !== undefined ? !!b.notifyFamily : !!suggestion.family;
  const notifyDoctor = actions.notifyDoctor !== undefined ? !!actions.notifyDoctor : cls.level !== 'watch';

  const id = uid();
  db.prepare(`INSERT INTO pain_escalations(id,patient_id,appointment_id,therapist_id,pain_before,pain_peak,pain_change,
    patient_words,action_angle,action_pause,action_ice,action_notify_doctor,notify_family,next_intensity,next_interval_days,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, patient.id, a.id, req.user.id, before, peak, change,
    words, angle, actions.pause ? 1 : 0, actions.ice ? 1 : 0, notifyDoctor ? 1 : 0,
    notifyFamily ? 1 : 0, nextIntensity, nextIntervalDays, nowIso(),
  );

  // 写回当次训练记录（保留疼痛升级快照）
  const session = {
    ...(J(a.session, {}) || {}),
    painEscalation: { id, before, peak, change, patientWords: words, actionAngle: angle, at: nowIso() },
  };
  db.prepare('UPDATE appointments SET session=? WHERE id=?').run(JSON.stringify(session), a.id);

  // 风险标签（疼痛高风险 / 疼痛敏感）
  let riskTagAdded = null;
  if (suggestion.tag) {
    riskTagAdded = suggestion.tag;
    db.prepare('UPDATE patients SET risk_tags=? WHERE id=?')
      .run(JSON.stringify(mergeRiskTags(patient.riskTags, suggestion.tag)), patient.id);
  }

  // 协同事件：进入治疗师交班（watch 级直接解决，不强制交班）
  const handoverRequired = cls.level !== 'watch';
  const eventId = createEvent({
    patientId: patient.id, appointmentId: a.id, planId: a.plan_id, type: 'pain_escalation',
    status: handoverRequired ? 'open' : 'resolved',
    title: `${patient.name} 训练中疼痛升级：${before}→${peak} 分（+${change}）`,
    detail: {
      escalationId: id, level: cls.level, reasons: cls.reasons,
      painBefore: before, painPeak: peak, painChange: change, patientWords: words,
      actionAngle: angle,
      actions: { pause: !!actions.pause, ice: !!actions.ice, notifyDoctor },
      notifyFamily, familyMessage: suggestion.family,
      nextIntensity, nextIntervalDays, doctorAdvice: '',
      handoverRequired,
      note: `疼痛 ${before}→${peak}（+${change}）；患者主诉：${words || '未记录'}；诱发角度：${angle || '未记录'}`,
    },
    user: req.user,
  });
  addStep(eventId, req.user, '现场处置',
    `暂停：${actions.pause ? '是' : '否'}｜记录角度：${angle || '—'}｜冰敷：${actions.ice ? '是' : '否'}｜通知医生：${notifyDoctor ? '是' : '否'}`);
  if (notifyFamily && suggestion.family) addStep(eventId, req.user, '家属提醒', suggestion.family);

  const row = db.prepare('SELECT * FROM pain_escalations WHERE id=?').get(id);
  return res.json({
    ok: true,
    escalation: mapEscalation(row),
    eventId,
    classification: cls,
    immediateActions: immediateActions({ level: cls.level, change, peak }, patient.category),
    familyMessage: suggestion.family,
    nextIntensity, nextIntervalDays, riskTagAdded,
  });
});

/* ---------- 治疗师调整系统建议（下次强度 / 间隔 / 家属提醒） ---------- */
router.patch('/escalations/:id', requireRole('therapist'), (req, res) => {
  const row = db.prepare('SELECT * FROM pain_escalations WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '疼痛升级记录不存在' });
  if (row.handover_ack_at) return res.status(409).json({ error: '已交班知悉的记录不可修改' });
  const b = req.body || {};
  const nextIntensity = b.nextIntensity !== undefined ? String(b.nextIntensity).slice(0, 300) : row.next_intensity;
  const nextIntervalDays = b.nextIntervalDays !== undefined
    ? Math.max(1, Math.min(14, Number(b.nextIntervalDays) || row.next_interval_days))
    : row.next_interval_days;
  const notifyFamily = b.notifyFamily !== undefined ? !!b.notifyFamily : !!row.notify_family;
  db.prepare('UPDATE pain_escalations SET next_intensity=?, next_interval_days=?, notify_family=? WHERE id=?')
    .run(nextIntensity, nextIntervalDays, notifyFamily ? 1 : 0, row.id);
  const ev = db.prepare("SELECT * FROM events WHERE type='pain_escalation' AND json_extract(detail,'$.escalationId')=?").get(row.id);
  if (ev) {
    const detail = J(ev.detail, {});
    detail.nextIntensity = nextIntensity;
    detail.nextIntervalDays = nextIntervalDays;
    detail.notifyFamily = notifyFamily;
    db.prepare('UPDATE events SET detail=? WHERE id=?').run(JSON.stringify(detail), ev.id);
  }
  return res.json({ ok: true });
});

/* ---------- 医生建议回填（治疗师通知医生后录入，进入交班） ---------- */
router.post('/escalations/:id/doctor-advice', requireRole('therapist', 'frontdesk'), (req, res) => {
  const row = db.prepare('SELECT * FROM pain_escalations WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '疼痛升级记录不存在' });
  const advice = String(req.body?.advice || '').trim();
  if (!advice) return res.status(400).json({ error: '请填写医生建议' });
  db.prepare('UPDATE pain_escalations SET doctor_advice=?, doctor_advice_by=?, doctor_advice_at=? WHERE id=?')
    .run(advice.slice(0, 500), req.user.name, nowIso(), row.id);

  const ev = db.prepare("SELECT * FROM events WHERE type='pain_escalation' AND json_extract(detail,'$.escalationId')=?").get(row.id);
  if (ev) {
    const detail = J(ev.detail, {});
    detail.doctorAdvice = advice;
    db.prepare('UPDATE events SET detail=? WHERE id=?').run(JSON.stringify(detail), ev.id);
    addStep(ev.id, req.user, '医生建议', advice);
  }
  return res.json({ ok: true });
});

/* ---------- 交班知悉（下一位治疗师在下次训练前确认；可解除疼痛风险标签） ---------- */
router.post('/escalations/:id/handover', requireRole('therapist'), (req, res) => {
  const row = db.prepare('SELECT * FROM pain_escalations WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '疼痛升级记录不存在' });
  if (row.handover_ack_at) return res.status(409).json({ error: '该交班记录已被知悉' });
  const note = String(req.body?.note || '').slice(0, 300);
  const resolveTag = !!req.body?.resolveTag;
  acknowledgeEscalation(row.id, req.user, note, resolveTag);
  return res.json({ ok: true });
});

/** 交班知悉共用逻辑：更新升级记录、事件留痕并解决、按需解除疼痛风险标签 */
export function acknowledgeEscalation(escId, user, note = '', resolveTag = false) {
  const esc = db.prepare('SELECT * FROM pain_escalations WHERE id=?').get(escId);
  if (!esc || esc.handover_ack_at) return esc;
  db.prepare('UPDATE pain_escalations SET handover_ack_by=?, handover_ack_name=?, handover_ack_at=?, closed_at=? WHERE id=?')
    .run(user.id, user.name, nowIso(), nowIso(), escId);
  const ev = db.prepare("SELECT * FROM events WHERE type='pain_escalation' AND json_extract(detail,'$.escalationId')=?").get(escId);
  if (ev) {
    addStep(ev.id, user, '交班知悉', note || '已阅读疼痛评分变化、患者主诉、暂停原因与医生建议，按降级强度执行本次训练');
    db.prepare("UPDATE events SET status='resolved' WHERE id=?").run(ev.id);
  }
  if (resolveTag) {
    const p = db.prepare('SELECT * FROM patients WHERE id=?').get(esc.patient_id);
    const tags = (J(p.risk_tags, []) || []).filter((t) => !String(t).startsWith('疼痛'));
    db.prepare('UPDATE patients SET risk_tags=? WHERE id=?').run(JSON.stringify(tags), p.id);
    if (ev) addStep(ev.id, user, '风险标签调整', '经评估患者已恢复，解除疼痛风险标签');
  }
  return esc;
}

export default router;
