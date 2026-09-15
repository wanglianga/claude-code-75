import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { Appointment } from '../types';
import { APPT_STATUS, PLAN_STATUS, todayStr, fmtDT } from '../labels';
import { Tabs, Section, StatusPill, Pill, RiskBadge, Modal, Field, Empty, Timeline } from '../components/ui';

export default function PatientPage() {
  const [tab, setTab] = useState('appts');
  return (
    <div>
      <FollowupBanner />
      <Tabs active={tab} onChange={setTab} items={[
        ['appts', '我的预约'], ['plan', '我的康复计划'], ['feedback', '训练反馈'], ['risk', '风险与提醒'],
      ]} />
      {tab === 'appts' && <MyAppointments />}
      {tab === 'plan' && <MyPlan />}
      {tab === 'feedback' && <MyFeedback />}
      {tab === 'risk' && <MyRisk />}
    </div>
  );
}

function useMe() {
  const { data, user } = useStore();
  const me = data?.patients.find((p) => p.id === user?.patientId);
  return { data, me };
}

/** 延迟疼痛触发的复诊建议横幅 */
function FollowupBanner() {
  const { data, user } = useStore();
  const open = (data?.events || []).filter((e) => e.patientId === user?.patientId
    && (e.type === 'delayed_pain' || e.type === 'pain_aggravation') && e.status !== 'resolved' && e.detail?.followup);
  if (!open.length) return null;
  return (
    <div className="alert-list tone-red mb8">
      {open.map((e) => <div key={e.id}>⚠ 复诊建议：{e.title}。请及时联系治疗师或复诊，中心会同步跟进。</div>)}
    </div>
  );
}

function MyAppointments() {
  const { data, me } = useMe();
  const [cancelAppt, setCancelAppt] = useState<Appointment | null>(null);
  const [reason, setReason] = useState('');
  const call = useStore((s) => s.call);
  const list = useMemo(() => (data?.appointments || [])
    .filter((a) => a.patientId === me?.id)
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)), [data, me]);
  if (!me) return null;
  const upcoming = list.filter((a) => ['scheduled', 'arrived'].includes(a.status) && a.date >= todayStr());
  const history = list.filter((a) => !upcoming.includes(a));
  return (
    <Section title="我的预约">
      <b>待训练</b>
      {upcoming.length === 0 ? <Empty>暂无待训练预约，请联系前台预约</Empty> : (
        <table className="table mt4">
          <thead><tr><th>日期时间</th><th>器械</th><th>治疗师</th><th>时长</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {upcoming.map((a) => (
              <tr key={a.id}>
                <td>{a.date} {a.start}</td><td>{a.equipmentName}</td><td>{a.therapistName}</td>
                <td>{a.duration}分钟</td><td><StatusPill dict={APPT_STATUS} value={a.status} /></td>
                <td><button className="btn btn-sm" onClick={() => setCancelAppt(a)}>取消</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <b className="mt8 block">历史记录</b>
      {history.length === 0 ? <Empty /> : (
        <table className="table mt4">
          <thead><tr><th>日期</th><th>器械</th><th>状态</th><th>训练内容</th><th>反馈</th></tr></thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}>
                <td>{a.date} {a.start}</td><td>{a.equipmentName}</td>
                <td><StatusPill dict={APPT_STATUS} value={a.status} /></td>
                <td className="cell-note">{a.session ? `${a.session.angle || ''} ${a.session.resistance || ''} ${a.session.reps || ''}` : (a.feedback?.cancelReason ? `取消：${a.feedback.cancelReason}` : '—')}</td>
                <td className="cell-note">{a.feedback?.effect ? `${a.feedback.effect}，疼痛${a.feedback.painAfter ?? '—'}分` : '—'}{a.feedback?.delayedPain && `；延迟疼痛${a.feedback.delayedPain.pain}分已反馈`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cancelAppt && (
        <Modal title={`取消预约：${cancelAppt.date} ${cancelAppt.start}`} onClose={() => setCancelAppt(null)}>
          <Field label="取消原因"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：身体不适/临时有事" /></Field>
          <div className="row-actions">
            <button className="btn btn-danger" onClick={async () => {
              if (await call(() => api(`/appointments/${cancelAppt.id}/cancel`, { body: { reason } }), '已取消')) { setCancelAppt(null); setReason(''); }
            }}>确认取消</button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

function MyPlan() {
  const { data, me } = useMe();
  if (!me || !data) return null;
  const plans = data.plans.filter((p) => p.patientId === me.id).sort((a, b) => b.version - a.version);
  const active = plans.find((p) => p.status === 'active');
  return (
    <Section title="我的康复计划（转诊/暂停/调整均保留衔接记录）">
      {me.status === 'paused' && <div className="alert-list tone-amber"><div>⚠ 当前处于暂停训练状态，恢复后将从原计划衔接继续。</div></div>}
      {me.status === 'referred' && <div className="alert-list tone-amber"><div>⚠ 已转诊，原计划存档可查，新计划建立后自动关联衔接。</div></div>}
      {active && (
        <div className="plan-node plan-active">
          <div className="plan-node-head"><b>当前计划 v{active.version}</b><StatusPill dict={PLAN_STATUS} value={active.status} /></div>
          <div className="plan-goals">目标：{active.goals}</div>
          <table className="table mt4">
            <thead><tr><th>器械类型</th><th>频次</th><th>单次时长</th><th>强度</th></tr></thead>
            <tbody>{active.items.map((it, i) => <tr key={i}><td>{it.equipmentType}</td><td>{it.freqPerWeek} 次/周</td><td>{it.duration} 分钟</td><td>{it.intensity}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <b className="mt8 block">计划沿革</b>
      <Timeline items={plans.map((p) => ({
        time: fmtDT(p.createdAt),
        title: <span>v{p.version} <StatusPill dict={PLAN_STATUS} value={p.status} /></span>,
        desc: <span>{p.goals}{p.note && <div className="muted">衔接说明：{p.note}</div>}{p.previousPlanId && <div className="muted">↳ 由旧版本衔接，历史训练记录保留</div>}</span>,
        tone: p.status === 'active' ? 'green' : 'gray',
      }))} />
    </Section>
  );
}

function MyFeedback() {
  const { data, me } = useMe();
  const call = useStore((s) => s.call);
  const toast = useStore((s) => s.toast);
  const [pain, setPain] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const list = useMemo(() => (data?.appointments || [])
    .filter((a) => a.patientId === me?.id && a.status === 'completed')
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)), [data, me]);
  if (!me) return null;
  const submit = async (a: Appointment) => {
    const p = Number(pain[a.id]);
    if (!(p >= 0 && p <= 10)) { toast('请填写0-10的疼痛评分', 'err'); return; }
    const ok = await call(async () => {
      const r = await api<{ followup: boolean }>(`/appointments/${a.id}/delayed-pain`, { body: { pain: p, note: note[a.id] || '' } });
      if (r.followup) toast('已收到反馈：疼痛评分较高，已为您生成复诊建议并通知治疗师', 'err');
    }, '反馈已提交，已同步给治疗师');
    if (ok) setPain((x) => ({ ...x, [a.id]: '' }));
  };
  return (
    <Section title="训练后反馈（延迟疼痛可持续反馈，将触发复诊建议）">
      {list.length === 0 && <Empty>暂无已完成的训练</Empty>}
      {list.map((a) => (
        <div key={a.id} className="feedback-row">
          <div>
            <b>{a.date} {a.start}</b> · {a.equipmentName}
            <div className="muted">当次反馈：{a.feedback?.effect || '—'}，训练后疼痛 {a.feedback?.painAfter ?? '—'} 分</div>
            {a.feedback?.delayedPain && <Pill tone="red">已反馈延迟疼痛 {a.feedback.delayedPain.pain} 分</Pill>}
          </div>
          {!a.feedback?.delayedPain && (
            <div className="feedback-form">
              <input type="number" min={0} max={10} placeholder="延迟疼痛0-10" value={pain[a.id] || ''} onChange={(e) => setPain({ ...pain, [a.id]: e.target.value })} />
              <input placeholder="说明（部位/持续时间）" value={note[a.id] || ''} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
              <button className="btn btn-sm btn-primary" onClick={() => submit(a)}>提交</button>
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function MyRisk() {
  const { data, me } = useMe();
  const meta = useStore((s) => s.meta);
  if (!me || !meta) return null;
  const cat = meta.categories[me.category];
  return (
    <Section title="我的风险与注意事项">
      <div className="patient-strip">
        <span><b>{me.name}</b> <Pill tone="blue">{cat?.label}</Pill> <RiskBadge level={me.riskLevel} /></span>
        <span>当前疼痛 {me.painScore} 分</span>
        {me.familyAccompany && <Pill tone="purple">需家属陪同</Pill>}
      </div>
      <b>禁忌动作</b>
      <div className="tag-row">{me.contraindications.length ? me.contraindications.map((c) => <Pill key={c} tone="red">{c}</Pill>) : <span className="muted">无</span>}</div>
      <b className="mt8 block">训练注意事项（{cat?.label}）</b>
      <ul className="tip-list">{cat?.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      {me.riskLevel === '高' && (
        <div className="alert-list tone-red"><div>⚠ 您属于高风险人群：每次训练前需确认医生医嘱、家属知情与紧急联系人，请配合治疗师核验。</div></div>
      )}
      <div className="grid2 mt8">
        <div><b>医生医嘱</b><div className="note-box">{me.doctorOrders || '—'}</div></div>
        <div><b>紧急联系人</b><div className="note-box">{me.emergencyName}　{me.emergencyPhone}</div></div>
      </div>
      {data && <div className="muted mt8">训练数据异常（心率超阈值、疼痛加重）时系统会自动提醒治疗师并生成协同处理事件。</div>}
    </Section>
  );
}
