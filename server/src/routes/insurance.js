import { Router } from 'express';
import db, { mapConfirmation, mapBilling, mapReconfirmation, J } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import {
  createEvent, addStep, getPatient, getPatientRow, getConfirmationRow,
  getReconfirmationRow, activePlanOf,
} from '../helpers.js';
import { uid, nowIso } from '../util.js';

const router = Router();
router.use(authRequired);

const CONF_BASE = `SELECT ic.*, p.name patient_name FROM insurance_confirmations ic
  JOIN patients p ON p.id=ic.patient_id`;

/* ---------- 确认单列表（患者/家属仅见本人） ---------- */
router.get('/confirmations', (req, res) => {
  const scoped = req.user.role === 'patient' || req.user.role === 'family';
  const rows = scoped
    ? db.prepare(`${CONF_BASE} WHERE ic.patient_id=? ORDER BY ic.created_at DESC`).all(req.user.patient_id)
    : db.prepare(`${CONF_BASE} ORDER BY ic.created_at DESC`).all();
  res.json({ confirmations: rows.map(mapConfirmation) });
});

/* ---------- 医生续开建议（→ 待家属确认） ---------- */
router.post('/confirmations/:id/advice', requireRole('doctor'), (req, res) => {
  const c = getConfirmationRow(req.params.id);
  if (!c) return res.status(404).json({ error: '确认单不存在' });
  if (c.status !== 'pending_advice') return res.status(409).json({ error: '当前状态不可填写建议' });
  const advice = String(req.body?.advice || '').trim();
  if (!advice) return res.status(400).json({ error: '请填写续开建议' });
  db.prepare("UPDATE insurance_confirmations SET doctor_advice=?, doctor_advice_by=?, doctor_advice_at=?, status='pending_family' WHERE id=?")
    .run(advice.slice(0, 500), req.user.name, nowIso(), c.id);
  if (c.event_id) addStep(c.event_id, req.user, '医生续开建议', advice);
  return res.json({ confirmation: mapConfirmation(db.prepare(`${CONF_BASE} WHERE ic.id=?`).get(c.id)) });
});

/* ---------- 家属确认自费继续（保留确认人/金额，同步前台收费与治疗师计划） ---------- */
router.post('/confirmations/:id/confirm', requireRole('family'), (req, res) => {
  const c = getConfirmationRow(req.params.id);
  if (!c) return res.status(404).json({ error: '确认单不存在' });
  if (req.user.patient_id !== c.patient_id) return res.status(403).json({ error: '仅可为关联患者确认' });
  if (c.status !== 'pending_family') return res.status(409).json({ error: '当前状态不可确认（需先由医生填写续开建议）' });
  const confirmer = String(req.body?.confirmerName || req.user.name).trim().slice(0, 40);
  const sessions = Math.max(1, Math.min(60, Number(req.body?.sessions) || 10));
  const amount = Math.round(sessions * c.self_pay_price * 100) / 100;
  const patient = getPatient(c.patient_id);

  // 确认单落痕：确认人 / 次数 / 金额
  db.prepare(`UPDATE insurance_confirmations SET status='confirmed', confirmer_name=?, confirm_sessions=?,
    confirm_amount=?, decided_at=? WHERE id=?`).run(confirmer, sessions, amount, nowIso(), c.id);

  // 患者医保项目追加自费额度，预约时可用
  const items = (patient.insuranceItems || []).map((it) => (it.name === c.insurance_item
    ? { ...it, selfPayPrice: c.self_pay_price, selfPayTotal: (it.selfPayTotal || 0) + sessions, selfPayUsed: it.selfPayUsed || 0 }
    : it));
  db.prepare('UPDATE patients SET insurance_items=? WHERE id=?').run(JSON.stringify(items), patient.id);

  // 同步前台收费：生成待收费记录（可追溯确认人/金额/治疗师说明）
  const billingId = uid();
  db.prepare(`INSERT INTO billing_records(id,patient_id,confirmation_id,item,sessions,amount,pay_type,status,confirmer_name,note,created_at)
    VALUES(?,?,?,?,?,?,'self_pay','unpaid',?,?,?)`)
    .run(billingId, patient.id, c.id, c.insurance_item, sessions, amount, confirmer,
      `家属确认自费继续训练 ${sessions} 次（医保「${c.insurance_item}」剩余 ${c.remaining} 次）`, nowIso());

  // 同步治疗师计划：在当前计划备注中留痕
  const plan = activePlanOf(patient.id);
  if (plan) {
    const stamp = `【自费确认】${confirmer} 已确认自费继续训练 ${sessions} 次，金额 ¥${amount}，已同步前台收费`;
    db.prepare('UPDATE plans SET note=? WHERE id=?')
      .run(plan.note ? `${plan.note}；${stamp}` : stamp, plan.id);
  }

  // 协同事件留痕：等待治疗师补充说明后闭环
  if (c.event_id) {
    addStep(c.event_id, req.user, '家属确认自费',
      `确认人：${confirmer}；自费 ${sessions} 次 × ¥${c.self_pay_price} = ¥${amount}；已同步前台收费与治疗师计划`);
    db.prepare("UPDATE events SET status='processing' WHERE id=?").run(c.event_id);
  }
  return res.json({ ok: true, amount, billingId });
});

/* ---------- 家属不同意自费（保留暂停原因，提示医生是否重开项目） ---------- */
router.post('/confirmations/:id/reject', requireRole('family'), (req, res) => {
  const c = getConfirmationRow(req.params.id);
  if (!c) return res.status(404).json({ error: '确认单不存在' });
  if (req.user.patient_id !== c.patient_id) return res.status(403).json({ error: '仅可为关联患者操作' });
  if (c.status !== 'pending_family') return res.status(409).json({ error: '当前状态不可操作' });
  const reason = String(req.body?.pauseReason || '').trim().slice(0, 300);
  if (!reason) return res.status(400).json({ error: '请填写暂停训练原因' });
  const patient = getPatient(c.patient_id);

  db.prepare("UPDATE insurance_confirmations SET status='rejected', pause_reason=?, decided_at=? WHERE id=?")
    .run(reason, nowIso(), c.id);

  // 暂停训练：计划与患者状态保留，恢复/重开时可衔接
  const plan = activePlanOf(patient.id);
  if (plan) db.prepare("UPDATE plans SET status='paused' WHERE id=?").run(plan.id);
  db.prepare("UPDATE patients SET status='paused' WHERE id=?").run(patient.id);

  // 原提醒事件留痕并关闭
  if (c.event_id) {
    addStep(c.event_id, req.user, '家属不同意自费', `暂停训练原因：${reason}`);
    db.prepare("UPDATE events SET status='resolved' WHERE id=?").run(c.event_id);
  }
  // 新事件：提示医生是否需要重开项目（医生端可见暂停原因）
  createEvent({
    patientId: patient.id, planId: plan ? plan.id : null, type: 'insurance_rejected',
    title: `${patient.name} 家属不同意自费，训练已暂停，请医生评估是否重开项目`,
    detail: {
      confirmationId: c.id, item: c.insurance_item, pauseReason: reason,
      needDoctorReopen: true,
      note: `暂停训练原因：${reason}。医生可在「暂停与重开」中查看并决定是否重开项目。`,
      handover: `暂停于计划 v${plan ? plan.version : '-'}（医保「${c.insurance_item}」剩余 ${c.remaining} 次），重开后从该计划衔接`,
    },
    user: req.user,
  });
  return res.json({ ok: true });
});

/* ---------- 治疗师说明（同步到收费记录，收费争议可追溯） ---------- */
router.post('/confirmations/:id/therapist-note', requireRole('therapist'), (req, res) => {
  const c = getConfirmationRow(req.params.id);
  if (!c) return res.status(404).json({ error: '确认单不存在' });
  if (c.status !== 'confirmed') return res.status(409).json({ error: '仅已确认的确认单可填写治疗师说明' });
  const note = String(req.body?.note || '').trim().slice(0, 300);
  if (!note) return res.status(400).json({ error: '请填写治疗师说明' });
  db.prepare('UPDATE insurance_confirmations SET therapist_note=?, therapist_note_by=? WHERE id=?')
    .run(note, req.user.name, c.id);
  // 同步到关联收费记录
  db.prepare('UPDATE billing_records SET therapist_note=? WHERE confirmation_id=?').run(note, c.id);
  if (c.event_id) {
    addStep(c.event_id, req.user, '治疗师说明', note);
    db.prepare("UPDATE events SET status='resolved' WHERE id=?").run(c.event_id);
  }
  return res.json({ ok: true });
});

/* ---------- 医生重开项目（家属拒绝后：新医保周期 + 新计划版本衔接） ---------- */
router.post('/confirmations/:id/reopen', requireRole('doctor'), (req, res) => {
  const c = getConfirmationRow(req.params.id);
  if (!c) return res.status(404).json({ error: '确认单不存在' });
  if (c.status !== 'rejected') return res.status(409).json({ error: '仅家属拒绝自费后可重开项目' });
  const sessions = Math.max(1, Math.min(60, Number(req.body?.sessions) || 10));
  const note = String(req.body?.note || '').trim().slice(0, 300);
  const patientRow = getPatientRow(c.patient_id);
  const patient = getPatient(c.patient_id);

  // 新医保周期：次数重置
  const items = (patient.insuranceItems || []).map((it) => (it.name === c.insurance_item
    ? { ...it, used: 0, total: sessions } : it));
  db.prepare('UPDATE patients SET insurance_items=? WHERE id=?').run(JSON.stringify(items), patient.id);

  // 新计划版本（保留与暂停计划的衔接）
  const prev = db.prepare('SELECT * FROM plans WHERE patient_id=? ORDER BY version DESC LIMIT 1').get(patient.id);
  const version = prev ? prev.version + 1 : 1;
  if (prev) db.prepare("UPDATE plans SET status='superseded' WHERE id=?").run(prev.id);
  const planId = uid();
  db.prepare(`INSERT INTO plans(id,patient_id,version,status,goals,items,note,rom,estimated_sessions,patient_reminder,previous_plan_id,created_by,created_at)
    VALUES(?,?,?,'active',?,?,?,?,?,?,?,?,?)`).run(
    planId, patient.id, version,
    prev ? prev.goals : '待评估后细化目标', prev ? prev.items : '[]',
    `医生重开项目：${note || '新医保周期继续训练'}（此前暂停原因：${c.pause_reason || '—'}）`,
    prev ? prev.rom : '', prev ? prev.estimated_sessions : sessions, prev ? prev.patient_reminder : '',
    prev ? prev.id : null, req.user.name, nowIso(),
  );
  db.prepare("UPDATE patients SET status='active' WHERE id=?").run(patient.id);
  db.prepare("UPDATE insurance_confirmations SET status='reopened' WHERE id=?").run(c.id);

  // 闭环「家属拒绝」事件并留痕
  const rejEvent = db.prepare("SELECT * FROM events WHERE type='insurance_rejected' AND json_extract(detail,'$.confirmationId')=? AND status!='resolved'")
    .get(c.id);
  if (rejEvent) {
    addStep(rejEvent.id, req.user, '医生重开项目',
      `新医保周期 ${sessions} 次；${note || '继续原康复目标'}；已生成计划 v${version} 衔接`);
    db.prepare("UPDATE events SET status='resolved' WHERE id=?").run(rejEvent.id);
  }
  createEvent({
    patientId: patient.id, planId, type: 'plan_adjust', status: 'resolved',
    title: `${patient.name} 康复计划 v${version}（医生重开项目）`,
    detail: {
      kind: 'doctor_reopen', note: note || '',
      handover: `因「${c.pause_reason || '家属不同意自费'}」暂停后由医生重开：医保「${c.insurance_item}」新周期 ${sessions} 次，由 v${prev ? prev.version : 0} 衔接，历史训练记录保留`,
    },
    user: req.user,
  });
  return res.json({ ok: true, planId, version });
});

/* ---------- 收费记录（前台收费管理；患者/家属看本人） ---------- */
router.get('/billing', (req, res) => {
  const base = `SELECT b.*, p.name patient_name FROM billing_records b JOIN patients p ON p.id=b.patient_id`;
  const scoped = req.user.role === 'patient' || req.user.role === 'family';
  const rows = scoped
    ? db.prepare(`${base} WHERE b.patient_id=? ORDER BY b.created_at DESC`).all(req.user.patient_id)
    : db.prepare(`${base} ORDER BY b.created_at DESC`).all();
  res.json({ billing: rows.map(mapBilling) });
});

router.post('/billing/:id/pay', requireRole('frontdesk'), (req, res) => {
  const b = db.prepare('SELECT * FROM billing_records WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '收费记录不存在' });
  if (b.status === 'paid') return res.status(409).json({ error: '该记录已收费' });
  db.prepare("UPDATE billing_records SET status='paid', paid_at=? WHERE id=?").run(nowIso(), b.id);
  const patient = getPatient(b.patient_id);
  createEvent({
    patientId: b.patient_id, type: 'insurance_selfpay', status: 'resolved',
    title: `${patient ? patient.name : ''} 自费费用已收取 ¥${b.amount}`,
    detail: {
      billingId: b.id, confirmationId: b.confirmation_id, amount: b.amount,
      note: `收费 ¥${b.amount}（${b.item} × ${b.sessions} 次）；确认人：${b.confirmer_name || '—'}；治疗师说明：${b.therapist_note || '—'}`,
    },
    user: req.user,
  });
  return res.json({ ok: true });
});

/* ---------- 计划重新确认列表（器械变更引起） ---------- */
router.get('/reconfirmations', (req, res) => {
  const base = `SELECT rc.*, p.name patient_name,
      ef.name from_equipment_name, et.name to_equipment_name,
      a.date appt_date, a.start appt_start
    FROM plan_reconfirmations rc
    JOIN patients p ON p.id=rc.patient_id
    LEFT JOIN equipment ef ON ef.id=rc.from_equipment_id
    LEFT JOIN equipment et ON et.id=rc.to_equipment_id
    LEFT JOIN appointments a ON a.id=rc.appointment_id`;
  const scoped = req.user.role === 'patient' || req.user.role === 'family';
  const rows = scoped
    ? db.prepare(`${base} WHERE rc.patient_id=? ORDER BY rc.created_at DESC`).all(req.user.patient_id)
    : db.prepare(`${base} ORDER BY rc.created_at DESC`).all();
  res.json({ reconfirmations: rows.map(mapReconfirmation) });
});

/* ---------- 治疗师重新确认：调整训练目标/动作范围/预计疗程/患者端动作提醒 ---------- */
router.post('/reconfirmations/:id/confirm', requireRole('therapist'), (req, res) => {
  const r = getReconfirmationRow(req.params.id);
  if (!r) return res.status(404).json({ error: '重确认记录不存在' });
  if (r.status !== 'pending') return res.status(409).json({ error: '该记录已确认' });
  const goals = String(req.body?.goals || '').trim().slice(0, 200);
  const rom = String(req.body?.rom || '').trim().slice(0, 100);
  const estimatedSessions = Math.max(1, Math.min(99, Number(req.body?.estimatedSessions) || r.old_estimated_sessions || 10));
  const patientReminder = String(req.body?.patientReminder || '').trim().slice(0, 300);
  if (!goals) return res.status(400).json({ error: '请填写调整后的训练目标' });
  if (!rom) return res.status(400).json({ error: '请填写调整后的动作范围' });

  // 调整当前计划：目标 / 动作范围 / 预计疗程 / 患者端动作提醒
  if (r.plan_id) {
    db.prepare('UPDATE plans SET goals=?, rom=?, estimated_sessions=?, patient_reminder=? WHERE id=?')
      .run(goals, rom, estimatedSessions, patientReminder, r.plan_id);
  }
  db.prepare(`UPDATE plan_reconfirmations SET status='confirmed', new_goals=?, new_rom=?, new_estimated_sessions=?,
    new_patient_reminder=?, confirmed_by=?, confirmed_at=? WHERE id=?`)
    .run(goals, rom, estimatedSessions, patientReminder, req.user.name, nowIso(), r.id);
  // 预约恢复可执行
  db.prepare("UPDATE appointments SET status='scheduled' WHERE id=? AND status='pending_reconfirm'").run(r.appointment_id);

  const patient = getPatient(r.patient_id);
  const ev = db.prepare("SELECT * FROM events WHERE type='plan_reconfirm' AND json_extract(detail,'$.reconfirmationId')=? AND status!='resolved'")
    .get(r.id);
  if (ev) {
    addStep(ev.id, req.user, '治疗师重新确认',
      `目标：${goals}；动作范围：${rom}；预计疗程：${estimatedSessions} 次；患者提醒：${patientReminder || '—'}`);
    db.prepare("UPDATE events SET status='resolved' WHERE id=?").run(ev.id);
  }
  // 给患者端一条提醒事件（动作提醒已更新）
  createEvent({
    patientId: r.patient_id, appointmentId: r.appointment_id, planId: r.plan_id,
    type: 'plan_adjust', status: 'resolved',
    title: `${patient ? patient.name : ''} 训练计划已按替代器械重新确认`,
    detail: {
      kind: 'equipment_reconfirm', reconfirmationId: r.id,
      note: `替代器械训练效果不同，治疗师已重新确认：目标「${goals}」，动作范围「${rom}」，预计疗程 ${estimatedSessions} 次`,
      handover: `患者端动作提醒已更新：${patientReminder || '—'}`,
    },
    user: req.user,
  });
  return res.json({ ok: true });
});

export default router;
