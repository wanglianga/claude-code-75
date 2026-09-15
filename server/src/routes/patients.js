import { Router } from 'express';
import db, { mapPatient, mapPlan } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { computeRiskLevel } from '../domain/risk.js';
import { PLAN_TEMPLATES } from '../domain/population.js';
import { createEvent, activePlanOf } from '../helpers.js';
import { uid, nowIso } from '../util.js';

const router = Router();
router.use(authRequired);

/* ---------- 患者建档 ---------- */
router.post('/', requireRole('frontdesk', 'therapist'), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.category) return res.status(400).json({ error: '姓名与人群类别必填' });
  const risk = computeRiskLevel({
    diagnosis: b.diagnosis, age: Number(b.age) || 0, pain_score: Number(b.painScore) || 0,
    category: b.category, post_op_stage: b.postOpStage || '',
  });
  const id = uid();
  db.prepare(`INSERT INTO patients(id,name,age,gender,category,diagnosis,post_op_stage,rom,contraindications,
    pain_score,family_accompany,insurance_items,therapist_id,risk_level,emergency_name,emergency_phone,doctor_orders,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`).run(
    id, b.name, Number(b.age) || null, b.gender || '', b.category, b.diagnosis || '', b.postOpStage || '',
    b.rom || '', JSON.stringify(b.contraindications || []), Number(b.painScore) || 0,
    b.familyAccompany ? 1 : 0, JSON.stringify(b.insuranceItems || []), b.therapistId || null, risk,
    b.emergencyName || '', b.emergencyPhone || '', b.doctorOrders || '', nowIso(),
  );
  // 建档即生成首版康复计划（按人群模板）
  const planId = uid();
  db.prepare(`INSERT INTO plans(id,patient_id,version,status,goals,items,note,previous_plan_id,created_by,created_at)
    VALUES(?,?,1,'active',?,?,?,NULL,?,?)`).run(
    planId, id, b.goals || '待首次评估后细化目标',
    JSON.stringify(PLAN_TEMPLATES[b.category] || []), '建档初始计划', req.user.name, nowIso(),
  );
  const row = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  return res.json({ patient: mapPatient(row) });
});

/* ---------- 档案更新 ---------- */
router.patch('/:id', requireRole('frontdesk', 'therapist'), (req, res) => {
  const row = db.prepare('SELECT * FROM patients WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '患者不存在' });
  const b = req.body || {};
  const merged = {
    name: b.name ?? row.name,
    age: b.age ?? row.age,
    gender: b.gender ?? row.gender,
    category: b.category ?? row.category,
    diagnosis: b.diagnosis ?? row.diagnosis,
    post_op_stage: b.postOpStage ?? row.post_op_stage,
    rom: b.rom ?? row.rom,
    contraindications: b.contraindications ? JSON.stringify(b.contraindications) : row.contraindications,
    pain_score: b.painScore ?? row.pain_score,
    family_accompany: b.familyAccompany === undefined ? row.family_accompany : (b.familyAccompany ? 1 : 0),
    insurance_items: b.insuranceItems ? JSON.stringify(b.insuranceItems) : row.insurance_items,
    therapist_id: b.therapistId ?? row.therapist_id,
    emergency_name: b.emergencyName ?? row.emergency_name,
    emergency_phone: b.emergencyPhone ?? row.emergency_phone,
    doctor_orders: b.doctorOrders ?? row.doctor_orders,
  };
  const risk = computeRiskLevel({
    diagnosis: merged.diagnosis, age: merged.age, pain_score: merged.pain_score,
    category: merged.category, post_op_stage: merged.post_op_stage,
  });
  db.prepare(`UPDATE patients SET name=?,age=?,gender=?,category=?,diagnosis=?,post_op_stage=?,rom=?,contraindications=?,
    pain_score=?,family_accompany=?,insurance_items=?,therapist_id=?,risk_level=?,emergency_name=?,emergency_phone=?,doctor_orders=?
    WHERE id=?`).run(
    merged.name, merged.age, merged.gender, merged.category, merged.diagnosis, merged.post_op_stage,
    merged.rom, merged.contraindications, merged.pain_score, merged.family_accompany, merged.insurance_items,
    merged.therapist_id, risk, merged.emergency_name, merged.emergency_phone, merged.doctor_orders, row.id,
  );
  return res.json({ patient: mapPatient(db.prepare('SELECT * FROM patients WHERE id=?').get(row.id)) });
});

/* ---------- 新计划版本（医生调整方案/治疗师阶段调整：保留与旧计划衔接） ---------- */
router.post('/:id/plans', requireRole('therapist', 'frontdesk'), (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: '患者不存在' });
  const { goals, items, note, kind } = req.body || {};
  if (!goals && (!items || !items.length)) return res.status(400).json({ error: '请填写目标或训练项目' });
  const prev = activePlanOf(patient.id);
  const version = prev ? prev.version + 1 : 1;
  if (prev) db.prepare("UPDATE plans SET status='superseded' WHERE id=?").run(prev.id);
  const id = uid();
  const kindLabel = { doctor: '医生调整方案', therapist: '治疗师阶段调整', referral: '转诊后新方案', resume: '恢复训练' }[kind] || '方案调整';
  db.prepare(`INSERT INTO plans(id,patient_id,version,status,goals,items,note,previous_plan_id,created_by,created_at)
    VALUES(?,?,?,'active',?,?,?,?,?,?)`).run(
    id, patient.id, version, goals || (prev ? prev.goals : ''), JSON.stringify(items || []),
    note || '', prev ? prev.id : null, req.user.name, nowIso(),
  );
  if (patient.status !== 'active') db.prepare("UPDATE patients SET status='active' WHERE id=?").run(patient.id);
  const done = db.prepare("SELECT COUNT(*) c FROM appointments WHERE patient_id=? AND status='completed'").get(patient.id).c;
  createEvent({
    patientId: patient.id, planId: id, type: 'plan_adjust', status: 'resolved',
    title: `${patient.name} 康复计划 v${version}（${kindLabel}）`,
    detail: { kind: kind || 'therapist', note: note || '', handover: prev ? `由 v${prev.version} 衔接，已完成训练 ${done} 次，历史记录保留可查` : '首版计划' },
    user: req.user,
  });
  const row = db.prepare('SELECT * FROM plans WHERE id=?').get(id);
  return res.json({ plan: mapPlan(row) });
});

export default router;
