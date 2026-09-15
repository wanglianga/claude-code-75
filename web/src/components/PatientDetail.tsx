import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { Patient, Plan, PlanItem } from '../types';
import { APPT_STATUS, PATIENT_STATUS, PLAN_STATUS, fmtDT } from '../labels';
import { Modal, Pill, RiskBadge, StatusPill, KV, Empty, Timeline, Field } from './ui';
import { RiskTags, usePatientEscalations } from './Pain';

/** 患者 360° 视图：档案 / 风险 / 医保 / 计划版本链（含衔接） / 训练历史 / 相关事件 */
export function PatientDetail({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const { data, meta, user } = useStore();
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const p = data?.patients.find((x) => x.id === patientId);
  const plans = useMemo(() => (data?.plans || []).filter((pl) => pl.patientId === patientId)
    .sort((a, b) => b.version - a.version), [data, patientId]);
  const appts = useMemo(() => (data?.appointments || []).filter((a) => a.patientId === patientId)
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, 8), [data, patientId]);
  const events = useMemo(() => (data?.events || []).filter((e) => e.patientId === patientId).slice(0, 6), [data, patientId]);
  const escalations = usePatientEscalations(patientId);
  if (!p || !data || !meta || !user) return null;
  const cat = meta.categories[p.category];
  const activePlan = plans.find((pl) => pl.status === 'active');
  const isStaff = ['therapist', 'frontdesk'].includes(user.role);

  return (
    <Modal wide onClose={onClose} title={
      <span>{p.name} <Pill tone="blue">{cat?.label || p.category}</Pill> <RiskBadge level={p.riskLevel} /> <StatusPill dict={PATIENT_STATUS} value={p.status} /></span>
    }>
      <div className="grid2">
        <div>
          <b>档案信息</b>
          <div className="kv-grid mt4">
            <KV k="年龄/性别">{p.age ?? '—'} / {p.gender || '—'}</KV>
            <KV k="诊断">{p.diagnosis}</KV>
            {p.category === 'post_op' && <KV k="术后阶段">{p.postOpStage}</KV>}
            <KV k="活动范围">{p.rom}</KV>
            <KV k="疼痛评分">{p.painScore} 分</KV>
            <KV k="家属陪同">{p.familyAccompany ? '需要' : (cat?.family === 'required' ? '必须（人群要求）' : '不需要')}</KV>
            <KV k="紧急联系人">{p.emergencyName} {p.emergencyPhone}</KV>
            <KV k="负责治疗师">{data.therapists.find((t) => t.id === p.therapistId)?.name || '未分配'}</KV>
          </div>
          <b className="mt8 block">禁忌动作</b>
          <div className="tag-row">{p.contraindications.length ? p.contraindications.map((c) => <Pill key={c} tone="red">{c}</Pill>) : <span className="muted">无</span>}</div>
          <b className="mt8 block">医生医嘱</b>
          <div className="note-box">{p.doctorOrders || '—'}</div>
          <b className="mt8 block">医保项目</b>
          {p.insuranceItems.map((it) => (
            <div key={it.name} className="ins-row">
              <span>{it.name}</span>
              <span className="muted">{it.used}/{it.total} 次</span>
              <span className="ins-bar"><i style={{ width: `${Math.min(100, (it.used / Math.max(1, it.total)) * 100)}%` }} /></span>
              {it.used >= it.total ? <Pill tone="red">已用完</Pill> : it.total - it.used <= 2 ? <Pill tone="amber">仅剩 {it.total - it.used}</Pill> : <Pill tone="green">余 {it.total - it.used}</Pill>}
            </div>
          ))}
        </div>
        <div>
          <b>风险提示（{cat?.label}）</b>
          {p.riskTags?.length > 0 && <div className="tag-row"><RiskTags patient={p} /></div>}
          <ul className="tip-list">
            {p.riskLevel === '高' && <li className="tip-red">高风险患者：训练前须确认医生医嘱、家属知情与紧急联系人</li>}
            {cat?.tips.map((t) => <li key={t}>{t}</li>)}
          </ul>
          {escalations.length > 0 && (
            <>
              <b className="mt8 block">疼痛升级交班记录</b>
              <div className="handover-mini">
                {escalations.slice(0, 3).map((esc) => (
                  <div key={esc.id} className={`handover-mini-item ${esc.handoverAckAt ? 'is-done' : 'is-pending'}`}>
                    <div className="row-between">
                      <b>{esc.date} {esc.start}</b>
                      {esc.handoverAckAt
                        ? <Pill tone="green">{esc.handoverAckName} 已知悉</Pill>
                        : <Pill tone="red">待交班知悉</Pill>}
                    </div>
                    <div className="muted">疼痛 {esc.painBefore}→<b className="pain-num">{esc.painPeak}</b>（+{esc.painChange}）｜角度 {esc.actionAngle || '—'}｜{esc.therapistName} 交班</div>
                    <div>主诉：{esc.patientWords || '—'}</div>
                    {esc.doctorAdvice && <div><b>医生建议：</b>{esc.doctorAdvice}</div>}
                    <div className="muted">下次强度：{esc.nextIntensity}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          <b className="mt8 block">相关协同事件</b>
          {events.length === 0 ? <Empty>暂无</Empty> : (
            <ul className="mini-list">
              {events.map((e) => (
                <li key={e.id}>
                  <StatusPill dict={{ open: ['待处理', 'red'], processing: ['处理中', 'amber'], resolved: ['已解决', 'green'] }} value={e.status} />
                  <span>{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt12">
        <div className="row-between">
          <b>康复计划版本链（转诊/暂停/调整均保留衔接）</b>
          {isStaff && (
            <span className="row-actions">
              <button className="btn btn-sm btn-primary" onClick={() => setPlanFormOpen(true)}>调整方案（新版本）</button>
              {activePlan && <button className="btn btn-sm btn-warn" onClick={() => setPauseOpen(true)}>暂停训练</button>}
              {plans.some((pl) => pl.status === 'paused') && (
                <button className="btn btn-sm" onClick={() => useStore.getState().call(() => api(`/plans/${plans.find((pl) => pl.status === 'paused')!.id}/resume`, { body: {} }), '已恢复训练')}>恢复训练</button>
              )}
              {activePlan && <button className="btn btn-sm" onClick={() => setReferOpen(true)}>转诊</button>}
            </span>
          )}
        </div>
        <div className="plan-chain">
          {plans.map((pl) => (
            <div key={pl.id} className={`plan-node ${pl.status === 'active' ? 'plan-active' : ''}`}>
              <div className="plan-node-head">
                <b>v{pl.version}</b>
                <StatusPill dict={PLAN_STATUS} value={pl.status} />
                <span className="muted">{fmtDT(pl.createdAt)} · {pl.createdBy}</span>
              </div>
              <div className="plan-goals">目标：{pl.goals}</div>
              {pl.items.length > 0 && (
                <table className="table mt4">
                  <thead><tr><th>器械类型</th><th>频次</th><th>单次时长</th><th>强度</th></tr></thead>
                  <tbody>{pl.items.map((it, i) => <tr key={i}><td>{it.equipmentType}</td><td>{it.freqPerWeek} 次/周</td><td>{it.duration} 分钟</td><td>{it.intensity}</td></tr>)}</tbody>
                </table>
              )}
              {pl.note && <div className="note-box mt4">衔接说明：{pl.note}</div>}
              {pl.previousPlanId && <div className="muted mt4">↳ 衔接自 v{plans.find((x) => x.id === pl.previousPlanId)?.version ?? '?'}，历史训练记录保留可查</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt12">
        <b>最近训练记录</b>
        {appts.length === 0 ? <Empty /> : (
          <table className="table mt4">
            <thead><tr><th>日期</th><th>器械</th><th>治疗师</th><th>状态</th><th>训练记录</th><th>反馈</th></tr></thead>
            <tbody>
              {appts.map((a) => (
                <tr key={a.id}>
                  <td>{a.date} {a.start}</td>
                  <td>{a.equipmentName}</td>
                  <td>{a.therapistName}</td>
                  <td><StatusPill dict={APPT_STATUS} value={a.status} />{a.late && <Pill tone="amber">迟到</Pill>}</td>
                  <td className="cell-note">{a.session ? `角度${a.session.angle || '—'} 阻力${a.session.resistance || '—'} ${a.session.reps || ''} 心率${a.session.heartRate ?? '—'}` : '—'}{a.session?.painEscalation && <div className="tip-red">疼痛升级 {a.session.painEscalation.before}→{a.session.painEscalation.peak}（{a.session.painEscalation.actionAngle || '—'}）</div>}</td>
                  <td className="cell-note">{a.feedback?.effect ? `${a.feedback.effect}，疼痛${a.feedback.painAfter ?? '—'}分` : (a.feedback?.cancelReason ? `取消：${a.feedback.cancelReason}` : '—')}{a.feedback?.delayedPain ? `；延迟疼痛${a.feedback.delayedPain.pain}分` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {planFormOpen && <PlanForm patient={p} onClose={() => setPlanFormOpen(false)} />}
      {pauseOpen && activePlan && <PauseModal plan={activePlan} onClose={() => setPauseOpen(false)} />}
      {referOpen && activePlan && <ReferModal plan={activePlan} onClose={() => setReferOpen(false)} />}
    </Modal>
  );
}

function PlanForm({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { call, meta } = useStore();
  const [goals, setGoals] = useState('');
  const [kind, setKind] = useState('doctor');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<PlanItem[]>([{ equipmentType: meta?.equipmentTypes[0] || '肌力训练', freqPerWeek: 3, duration: meta?.categories[patient.category]?.defaultDuration || 45, intensity: '' }]);
  const setItem = (i: number, patch: Partial<PlanItem>) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const submit = async () => {
    const ok = await call(() => api(`/patients/${patient.id}/plans`, { body: { goals, items, note, kind } }), '已生成新计划版本并保留衔接');
    if (ok) onClose();
  };
  return (
    <Modal title="调整康复方案（生成新版本，旧版本存档衔接）" onClose={onClose} wide>
      <div className="grid2">
        <Field label="调整原因">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="doctor">医生调整方案</option>
            <option value="therapist">治疗师阶段调整</option>
            <option value="referral">转诊后新方案</option>
            <option value="resume">恢复训练</option>
          </select>
        </Field>
        <Field label="阶段目标">
          <input value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="如：屈膝活动度提升至110°" />
        </Field>
      </div>
      <b>训练项目</b>
      {items.map((it, i) => (
        <div className="plan-item-row" key={i}>
          <select value={it.equipmentType} onChange={(e) => setItem(i, { equipmentType: e.target.value })}>
            {meta?.equipmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" min={1} max={14} value={it.freqPerWeek} onChange={(e) => setItem(i, { freqPerWeek: Number(e.target.value) })} title="次/周" />
          <input type="number" min={10} max={120} step={5} value={it.duration} onChange={(e) => setItem(i, { duration: Number(e.target.value) })} title="分钟" />
          <input placeholder="强度说明" value={it.intensity} onChange={(e) => setItem(i, { intensity: e.target.value })} />
          <button className="btn btn-sm btn-ghost" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}>删</button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => setItems((arr) => [...arr, { equipmentType: meta?.equipmentTypes[0] || '肌力训练', freqPerWeek: 2, duration: 30, intensity: '' }])}>+ 添加项目</button>
      <Field label="衔接说明（保留原计划与新计划的衔接关系）">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：医生查房后降低负重强度，由v1衔接，已完成6次训练记录保留" />
      </Field>
      <div className="row-actions mt8"><button className="btn btn-primary" onClick={submit}>保存新版本</button></div>
    </Modal>
  );
}

function PauseModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const call = useStore((s) => s.call);
  const [reason, setReason] = useState('');
  return (
    <Modal title="暂停训练" onClose={onClose}>
      <Field label="暂停原因"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：患者发热/外出/伤口复查" /></Field>
      <div className="row-actions"><button className="btn btn-warn" onClick={async () => { if (await call(() => api(`/plans/${plan.id}/pause`, { body: { reason } }), '已暂停，原计划保留可衔接恢复')) onClose(); }}>确认暂停</button></div>
    </Modal>
  );
}

function ReferModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const call = useStore((s) => s.call);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal title="转诊（保留原计划与衔接说明）" onClose={onClose}>
      <Field label="转诊去向"><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="如：上级医院康复科 / 另一家社区中心" /></Field>
      <Field label="衔接说明"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：术后4周，屈膝95°，建议继续关节松动训练" /></Field>
      <div className="row-actions"><button className="btn btn-primary" onClick={async () => { if (await call(() => api(`/plans/${plan.id}/refer`, { body: { target, note } }), '已转诊，原计划存档并保留衔接')) onClose(); }}>确认转诊</button></div>
    </Modal>
  );
}
