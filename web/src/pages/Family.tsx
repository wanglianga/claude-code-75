import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { InsuranceConfirmation } from '../types';
import { APPT_STATUS, BILLING_STATUS, PLAN_STATUS, todayStr, fmtDT } from '../labels';
import { Tabs, Section, StatusPill, Pill, RiskBadge, Modal, Field, Empty, Timeline, KV } from '../components/ui';
import { EventBoard } from '../components/Events';
import { PainEscalationNotice, RiskTags } from '../components/Pain';
import { ConfirmationDetail } from '../components/Insurance';

export default function FamilyPage() {
  const [tab, setTab] = useState('overview');
  const data = useStore((s) => s.data);
  const pendingConfirm = (data?.confirmations || []).filter((c) => c.status === 'pending_family').length;
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[
        ['overview', '患者概况'],
        ['insurance', `医保确认${pendingConfirm ? `（${pendingConfirm}）` : ''}`],
        ['appts', '预约与知情确认'],
        ['request', '请求与协同'],
      ]} />
      {tab === 'overview' && <Overview />}
      {tab === 'insurance' && <InsurancePanel />}
      {tab === 'appts' && <ApptsConsent />}
      {tab === 'request' && <RequestPanel />}
    </div>
  );
}

function useLinked() {
  const { data, user } = useStore();
  const patient = data?.patients.find((p) => p.id === user?.patientId);
  return { data, patient };
}

/* ---------------- 医保确认：剩余次数/自费价格/医生建议 → 家属确认或拒绝 ---------------- */
function InsurancePanel() {
  const { data, patient } = useLinked();
  const { user, call } = useStore();
  const [confirmTarget, setConfirmTarget] = useState<InsuranceConfirmation | null>(null);
  const [rejectTarget, setRejectTarget] = useState<InsuranceConfirmation | null>(null);
  const [confirmer, setConfirmer] = useState('');
  const [sessions, setSessions] = useState('10');
  const [pauseReason, setPauseReason] = useState('');
  if (!patient || !data || !user) return null;
  const list = (data.confirmations || []).filter((c) => c.patientId === patient.id);
  const pending = list.filter((c) => ['pending_advice', 'pending_family'].includes(c.status));
  const history = list.filter((c) => !pending.includes(c));
  const billing = (data.billing || []).filter((b) => b.patientId === patient.id);

  return (
    <div>
      <Section title="医保次数不足 · 家属确认（确认结果同步前台收费与治疗师计划）">
        {pending.length === 0 && <Empty>当前无待确认的医保提醒</Empty>}
        {pending.map((c) => (
          <div key={c.id} className="ins-conf-card ins-conf-pending">
            <div className="row-between">
              <b>医保「{c.insuranceItem}」仅剩 {c.remaining} 次，即将用尽</b>
              <StatusPill dict={{ pending_advice: ['待医生续开建议', 'amber'], pending_family: ['待家属确认', 'blue'] }} value={c.status} />
            </div>
            <div className="kv-grid mt4">
              <KV k="剩余次数"><b>{c.remaining} 次</b></KV>
              <KV k="自费价格"><b>¥{c.selfPayPrice}/次</b></KV>
              <KV k="医生续开建议">{c.doctorAdvice || '待医生填写，填写后您可确认'}</KV>
            </div>
            {c.status === 'pending_family' && (
              <div className="row-actions mt8">
                <button className="btn btn-primary" onClick={() => { setConfirmTarget(c); setConfirmer(user.name); setSessions('10'); }}>确认自费继续训练</button>
                <button className="btn btn-danger" onClick={() => { setRejectTarget(c); setPauseReason(''); }}>不同意自费（暂停训练）</button>
              </div>
            )}
            {c.status === 'pending_advice' && <div className="muted mt4">医生续开建议出具后，即可在此确认是否自费继续。</div>}
          </div>
        ))}
      </Section>

      {history.length > 0 && (
        <Section title="确认记录（确认人/金额/治疗师说明留痕，收费争议可追溯）">
          {history.map((c) => <ConfirmationDetail key={c.id} c={c} />)}
        </Section>
      )}

      {billing.length > 0 && (
        <Section title="我的账单">
          <table className="table">
            <thead><tr><th>项目</th><th>次数</th><th>金额</th><th>状态</th><th>确认人</th><th>治疗师说明</th><th>时间</th></tr></thead>
            <tbody>
              {billing.map((b) => (
                <tr key={b.id}>
                  <td>{b.item}</td><td>{b.sessions} 次</td><td>¥{b.amount}</td>
                  <td><StatusPill dict={BILLING_STATUS} value={b.status} /></td>
                  <td>{b.confirmerName || '—'}</td>
                  <td className="cell-note">{b.therapistNote || '—'}</td>
                  <td>{fmtDT(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {confirmTarget && (
        <Modal title={`确认自费继续训练 · 「${confirmTarget.insuranceItem}」`} onClose={() => setConfirmTarget(null)}>
          <div className="note-box">
            自费 ¥{confirmTarget.selfPayPrice}/次。确认后：① 生成前台收费记录；② 同步治疗师训练计划；③ 保留确认人/金额/治疗师说明，收费争议可追溯。
          </div>
          <div className="grid2">
            <Field label="确认人"><input value={confirmer} onChange={(e) => setConfirmer(e.target.value)} /></Field>
            <Field label="购买次数">
              <select value={sessions} onChange={(e) => setSessions(e.target.value)}>
                {['5', '10', '15', '20'].map((n) => <option key={n} value={n}>{n} 次</option>)}
              </select>
            </Field>
          </div>
          <div className="confirm-bar">
            <span>应付金额：<b>¥{(Number(sessions) || 0) * confirmTarget.selfPayPrice}</b>（{sessions} 次 × ¥{confirmTarget.selfPayPrice}）</span>
            <button className="btn btn-primary" disabled={!confirmer.trim()} onClick={async () => {
              if (await call(() => api(`/insurance/confirmations/${confirmTarget.id}/confirm`, { body: { confirmerName: confirmer, sessions: Number(sessions) } }), '已确认自费继续训练，已同步前台收费与治疗师计划')) setConfirmTarget(null);
            }}>确认自费</button>
          </div>
        </Modal>
      )}
      {rejectTarget && (
        <Modal title={`不同意自费 · 「${rejectTarget.insuranceItem}」`} onClose={() => setRejectTarget(null)}>
          <div className="alert-list tone-amber">
            <div>⚠ 不同意自费后训练将暂停，暂停原因会保留并同步给医生，医生将评估是否需要重开项目。</div>
          </div>
          <Field label="暂停训练原因（必填，将保留并同步医生端）">
            <textarea rows={3} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} placeholder="如：自费费用较高，家庭经济困难，暂停训练" />
          </Field>
          <div className="row-actions">
            <button className="btn btn-danger" disabled={!pauseReason.trim()} onClick={async () => {
              if (await call(() => api(`/insurance/confirmations/${rejectTarget.id}/reject`, { body: { pauseReason } }), '已记录：训练暂停，原因已同步医生评估')) setRejectTarget(null);
            }}>确认不同意自费</button>
            <button className="btn" onClick={() => setRejectTarget(null)}>再考虑一下</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Overview() {
  const { data, patient } = useLinked();
  const meta = useStore((s) => s.meta);
  if (!patient || !data || !meta) return null;
  const cat = meta.categories[patient.category];
  const activePlan = data.plans.find((p) => p.patientId === patient.id && p.status === 'active');
  return (
    <Section title="关联患者概况">
      <PainEscalationNotice patientId={patient.id} />
      <div className="patient-strip">
        <span><b>{patient.name}</b> <Pill tone="blue">{cat?.label}</Pill> <RiskBadge level={patient.riskLevel} /></span>
        <span>疼痛 {patient.painScore} 分</span>
        <RiskTags patient={patient} />
        {patient.familyAccompany && <Pill tone="purple">需家属陪同</Pill>}
      </div>
      <div className="kv-grid">
        <KV k="诊断">{patient.diagnosis}</KV>
        <KV k="活动范围">{patient.rom}</KV>
        <KV k="禁忌动作">{patient.contraindications.join('、') || '无'}</KV>
        <KV k="医生医嘱">{patient.doctorOrders}</KV>
        <KV k="紧急联系人">{patient.emergencyName} {patient.emergencyPhone}</KV>
        <KV k="负责治疗师">{data.therapists.find((t) => t.id === patient.therapistId)?.name || '未分配'}</KV>
      </div>
      {activePlan && (
        <>
          <b className="mt8 block">当前康复计划 v{activePlan.version}：{activePlan.goals}</b>
          <table className="table mt4">
            <thead><tr><th>器械类型</th><th>频次</th><th>单次时长</th><th>强度</th></tr></thead>
            <tbody>{activePlan.items.map((it, i) => <tr key={i}><td>{it.equipmentType}</td><td>{it.freqPerWeek} 次/周</td><td>{it.duration} 分钟</td><td>{it.intensity}</td></tr>)}</tbody>
          </table>
        </>
      )}
      <b className="mt8 block">家属须知（{cat?.label}）</b>
      <ul className="tip-list">
        {cat?.family === 'required' && <li className="tip-red">本人群训练必须家属全程陪同</li>}
        {cat?.family === 'recommended' && <li>建议家属陪同往返与居家练习督导</li>}
        {cat?.tips.slice(0, 3).map((t) => <li key={t}>{t}</li>)}
      </ul>
    </Section>
  );
}

function ApptsConsent() {
  const { data, patient } = useLinked();
  const call = useStore((s) => s.call);
  const list = useMemo(() => (data?.appointments || [])
    .filter((a) => a.patientId === patient?.id)
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)), [data, patient]);
  if (!patient) return null;
  const upcoming = list.filter((a) => ['scheduled', 'arrived', 'pending_reconfirm'].includes(a.status) && a.date >= todayStr());
  const plans = (data?.plans || []).filter((p) => p.patientId === patient.id).sort((a, b) => b.version - a.version);
  return (
    <Section title="预约与知情确认（高风险患者训练前需家属知情）">
      {patient.riskLevel === '高' && (
        <div className="alert-list tone-amber"><div>⚠ {patient.name} 为高风险患者：每次训练前需完成 医嘱确认 + 家属知情 + 紧急联系人确认，您可在此提前在线确认知情。</div></div>
      )}
      {upcoming.length === 0 ? <Empty>暂无待训练预约</Empty> : (
        <table className="table">
          <thead><tr><th>日期时间</th><th>器械</th><th>治疗师</th><th>状态</th><th>家属知情</th></tr></thead>
          <tbody>
            {upcoming.map((a) => (
              <tr key={a.id}>
                <td>{a.date} {a.start}</td><td>{a.equipmentName}</td><td>{a.therapistName}</td>
                <td><StatusPill dict={APPT_STATUS} value={a.status} /></td>
                <td>
                  {a.familyConsent ? <Pill tone="green">已确认知情</Pill> : (
                    <button className="btn btn-sm btn-primary" onClick={() => call(() => api(`/appointments/${a.id}/family-consent`, { body: {} }), '已完成知情确认')}>确认知情</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <b className="mt8 block">计划沿革</b>
      <Timeline items={plans.map((p) => ({
        time: fmtDT(p.createdAt),
        title: <span>v{p.version} <StatusPill dict={PLAN_STATUS} value={p.status} /></span>,
        desc: <span>{p.goals}{p.note && <div className="muted">衔接说明：{p.note}</div>}</span>,
        tone: p.status === 'active' ? 'green' : 'gray',
      }))} />
    </Section>
  );
}

function RequestPanel() {
  const { patient } = useLinked();
  const call = useStore((s) => s.call);
  const [note, setNote] = useState('');
  if (!patient) return null;
  return (
    <div>
      <Section title="加量请求（提交后由治疗师评估，在同一康复计划中处理）">
        <Field label="请求说明">
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：最近状态不错，希望增加训练时长/强度" />
        </Field>
        <div className="row-actions">
          <button className="btn btn-primary" disabled={!note.trim()} onClick={async () => {
            const ok = await call(() => api('/events', { body: { type: 'family_intensity', patientId: patient.id, note } }), '已提交，治疗师将评估并回复');
            if (ok) setNote('');
          }}>提交加量请求</button>
        </div>
      </Section>
      <EventBoard filter={(e) => e.patientId === patient.id} title="协同事件（可留言参与处理）" />
    </div>
  );
}
