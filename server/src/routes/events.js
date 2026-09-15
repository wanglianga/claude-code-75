import { Router } from 'express';
import db, { mapEvent, mapStep } from '../db.js';
import { authRequired } from '../auth.js';
import { EVENT_TYPES } from '../domain/population.js';
import { createEvent, addStep, getPatient } from '../helpers.js';

const router = Router();
router.use(authRequired);

/* ---------- 发起协同事件（家属加量请求、故障上报等） ---------- */
router.post('/', (req, res) => {
  const { type, patientId, appointmentId, equipmentId, note } = req.body || {};
  if (!EVENT_TYPES[type]) return res.status(400).json({ error: '未知事件类型' });
  let title = EVENT_TYPES[type].label;
  if (patientId) {
    const p = getPatient(patientId);
    if (!p) return res.status(404).json({ error: '患者不存在' });
    if ((req.user.role === 'patient' || req.user.role === 'family') && req.user.patient_id !== patientId) {
      return res.status(403).json({ error: '仅可为关联患者发起' });
    }
    title = `${p.name}：${title}`;
  }
  if (equipmentId) {
    const eq = db.prepare('SELECT * FROM equipment WHERE id=?').get(equipmentId);
    if (!eq) return res.status(404).json({ error: '器械不存在' });
    title = `器械「${eq.name}」${EVENT_TYPES[type].label}`;
  }
  const id = createEvent({
    patientId: patientId || null, appointmentId: appointmentId || null, equipmentId: equipmentId || null,
    type, title, detail: { note: note || '' }, user: req.user,
  });
  const row = db.prepare('SELECT ev.*, p.name patient_name FROM events ev LEFT JOIN patients p ON p.id=ev.patient_id WHERE ev.id=?').get(id);
  const steps = db.prepare('SELECT * FROM event_steps WHERE event_id=? ORDER BY created_at').all(id).map(mapStep);
  return res.json({ event: mapEvent(row, steps) });
});

/* ---------- 追加处理记录（各角色在同一康复计划中协同） ---------- */
router.post('/:id/steps', (req, res) => {
  const { action, note } = req.body || {};
  if (!action) return res.status(400).json({ error: '请填写处理动作' });
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: '事件不存在' });
  addStep(ev.id, req.user, String(action).slice(0, 40), note || '');
  const steps = db.prepare('SELECT * FROM event_steps WHERE event_id=? ORDER BY created_at').all(ev.id).map(mapStep);
  return res.json({ steps });
});

/* ---------- 流转事件状态（工作人员角色） ---------- */
router.post('/:id/status', (req, res) => {
  const { status, note } = req.body || {};
  if (!['open', 'processing', 'resolved'].includes(status)) return res.status(400).json({ error: '非法状态' });
  if (!['frontdesk', 'therapist', 'maintenance'].includes(req.user.role)) {
    return res.status(403).json({ error: '患者/家属可留言，状态由工作人员流转' });
  }
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: '事件不存在' });
  db.prepare('UPDATE events SET status=? WHERE id=?').run(status, ev.id);
  const label = { open: '重新打开', processing: '开始处理', resolved: '标记解决' }[status];
  addStep(ev.id, req.user, label, note || '');
  const row = db.prepare('SELECT ev.*, p.name patient_name FROM events ev LEFT JOIN patients p ON p.id=ev.patient_id WHERE ev.id=?').get(ev.id);
  const steps = db.prepare('SELECT * FROM event_steps WHERE event_id=? ORDER BY created_at').all(ev.id).map(mapStep);
  return res.json({ event: mapEvent(row, steps) });
});

export default router;
