import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { APPT_STATUS, PLAN_STATUS, todayStr, fmtDT } from '../labels';
import { Tabs, Section, StatusPill, Pill, RiskBadge, Field, Empty, Timeline, KV } from '../components/ui';
import { EventBoard } from '../components/Events';
import { PainEscalationNotice, RiskTags } from '../components/Pain';

export default function FamilyPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[
        ['overview', '患者概况'], ['appts', '预约与知情确认'], ['request', '请求与协同'],
      ]} />
      {tab === 'overview' && <Overview />}
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
  const upcoming = list.filter((a) => ['scheduled', 'arrived'].includes(a.status) && a.date >= todayStr());
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
