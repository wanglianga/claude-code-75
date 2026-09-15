import { Router } from 'express';
import db from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { createEvent } from '../helpers.js';

const router = Router();
router.use(authRequired);

function loadPlanWithPatient(id) {
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(id);
  if (!plan) return {};
  const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(plan.patient_id);
  return { plan, patient };
}

/* ---------- 暂停训练（保留原计划，恢复时可衔接） ---------- */
router.post('/:id/pause', requireRole('therapist', 'frontdesk'), (req, res) => {
  const { reason } = req.body || {};
  const { plan, patient } = loadPlanWithPatient(req.params.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  if (plan.status !== 'active') return res.status(409).json({ error: '仅进行中的计划可暂停' });
  db.prepare("UPDATE plans SET status='paused' WHERE id=?").run(plan.id);
  db.prepare("UPDATE patients SET status='paused' WHERE id=?").run(patient.id);
  createEvent({
    patientId: patient.id, planId: plan.id, type: 'pause', status: 'resolved',
    title: `${patient.name} 暂停训练（计划 v${plan.version}）`,
    detail: { reason: reason || '', note: reason || '', handover: `暂停于 v${plan.version}，恢复时从该计划衔接，历史训练记录保留` },
    user: req.user,
  });
  return res.json({ ok: true });
});

/* ---------- 恢复训练 ---------- */
router.post('/:id/resume', requireRole('therapist', 'frontdesk'), (req, res) => {
  const { plan, patient } = loadPlanWithPatient(req.params.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  if (plan.status !== 'paused') return res.status(409).json({ error: '仅已暂停的计划可恢复' });
  db.prepare("UPDATE plans SET status='active' WHERE id=?").run(plan.id);
  db.prepare("UPDATE patients SET status='active' WHERE id=?").run(patient.id);
  createEvent({
    patientId: patient.id, planId: plan.id, type: 'plan_adjust', status: 'resolved',
    title: `${patient.name} 恢复训练（继续计划 v${plan.version}）`,
    detail: { kind: 'resume', note: req.body?.note || '', handover: `自暂停处恢复，沿用 v${plan.version} 计划` },
    user: req.user,
  });
  return res.json({ ok: true });
});

/* ---------- 转诊（保留原计划与衔接说明） ---------- */
router.post('/:id/refer', requireRole('therapist', 'frontdesk'), (req, res) => {
  const { target, note } = req.body || {};
  if (!target) return res.status(400).json({ error: '请填写转诊去向' });
  const { plan, patient } = loadPlanWithPatient(req.params.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  db.prepare("UPDATE plans SET status='referred' WHERE id=?").run(plan.id);
  db.prepare("UPDATE patients SET status='referred' WHERE id=?").run(patient.id);
  const done = db.prepare("SELECT COUNT(*) c FROM appointments WHERE patient_id=? AND status='completed'").get(patient.id).c;
  const ins = JSON.parse(patient.insurance_items || '[]')[0];
  createEvent({
    patientId: patient.id, planId: plan.id, type: 'referral', status: 'resolved',
    title: `${patient.name} 转诊至「${target}」`,
    detail: {
      target, note: note || '',
      handover: `转诊衔接：已完成训练 ${done} 次，医保「${ins ? ins.name : '-'}」已用 ${ins ? ins.used : 0}/${ins ? ins.total : 0} 次；原计划 v${plan.version} 存档可查，新计划建立后自动关联`,
    },
    user: req.user,
  });
  return res.json({ ok: true });
});

export default router;
