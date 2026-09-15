import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { Appointment, Patient } from '../types';
import { APPT_STATUS, WEEKDAYS, todayStr } from '../labels';
import { Tabs, Section, StatusPill, Pill, RiskBadge, Modal, Field, Empty, AlertList } from '../components/ui';
import { EventBoard } from '../components/Events';
import { PatientDetail } from '../components/PatientDetail';

export default function Therapist() {
  const [tab, setTab] = useState('exec');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[
        ['exec', '今日执行'], ['schedule', '我的日程'], ['patients', '我的患者'], ['events', '协同事件'], ['leave', '请假与排班'],
      ]} />
      {tab === 'exec' && <ExecPanel />}
      {tab === 'schedule' && <SchedulePanel />}
      {tab === 'patients' && <MyPatients />}
      {tab === 'events' && <EventBoard />}
      {tab === 'leave' && <LeavePanel />}
    </div>
  );
}

/* ---------------- 今日执行：核验 → 训练记录 → 完成/中止 ---------------- */
function ExecPanel() {
  const { data, user } = useStore();
  const today = todayStr();
  const list = useMemo(() => (data?.appointments || [])
    .filter((a) => a.therapistId === user?.id && (a.date === today || ['arrived', 'in_progress'].includes(a.status)))
    .sort((a, b) => a.start.localeCompare(b.start)), [data, user, today]);
  if (!data) return null;
  return (
    <Section title="今日训练执行（到场核验 → 训练记录 → 完成反馈）">
      {list.length === 0 && <Empty>今日暂无训练安排</Empty>}
      <div className="exec-list">
        {list.map((a) => <ExecCard key={a.id} appt={a} />)}
      </div>
    </Section>
  );
}

function ExecCard({ appt }: { appt: Appointment }) {
  const data = useStore((s) => s.data)!;
  const p = data.patients.find((x) => x.id === appt.patientId);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  if (!p) return null;
  return (
    <div className="exec-card">
      <div className="exec-head">
        <div>
          <b>{a_time(appt)}</b>　<b>{p.name}</b> <RiskBadge level={p.riskLevel} /> <StatusPill dict={APPT_STATUS} value={appt.status} />
          {appt.late && <Pill tone="amber">迟到</Pill>}
          {p.familyAccompany && <Pill tone="purple">需家属陪同</Pill>}
        </div>
        <div className="muted">{appt.equipmentName} · {appt.duration}分钟 · 医保 {appt.insuranceItem || '自费'}</div>
      </div>
      {appt.riskSnapshot && appt.riskSnapshot.tips.length > 0 && (
        <div className="tip-inline">{appt.riskSnapshot.tips.slice(0, 3).map((t, i) => <span key={i} className={`tip-${t.level === '禁忌' || t.level === '高风险' ? 'red' : 'gray'}`}>【{t.level}】{t.text}</span>)}</div>
      )}
      {appt.status === 'scheduled' && <div className="muted">等待前台登记到场…</div>}
      {appt.status === 'arrived' && (
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => setCheckinOpen(true)}>到场核验并开始训练</button>
        </div>
      )}
      {appt.status === 'in_progress' && (
        <>
          <SessionForm appt={appt} patient={p} />
          <div className="row-actions mt8">
            <button className="btn btn-primary" onClick={() => setCompleteOpen(true)}>完成训练并填写反馈</button>
            <button className="btn btn-danger" onClick={() => setAbortOpen(true)}>异常中止</button>
          </div>
        </>
      )}
      {appt.status === 'completed' && appt.feedback && (
        <div className="note-box">已完成：疗效 {appt.feedback.effect || '—'}，训练后疼痛 {appt.feedback.painAfter ?? '—'} 分{appt.feedback.note ? `；${appt.feedback.note}` : ''}</div>
      )}
      {checkinOpen && <CheckinModal appt={appt} patient={p} onClose={() => setCheckinOpen(false)} />}
      {completeOpen && <CompleteModal appt={appt} onClose={() => setCompleteOpen(false)} />}
      {abortOpen && <AbortModal appt={appt} onClose={() => setAbortOpen(false)} />}
    </div>
  );
}

const a_time = (a: Appointment) => `${a.date} ${a.start}`;

/* ---------------- 到场核验（按人群呈现评估项；高风险需三项确认） ---------------- */
function CheckinModal({ appt, patient, onClose }: { appt: Appointment; patient: Patient; onClose: () => void }) {
  const { call, meta } = useStore();
  const cat = meta?.categories[patient.category];
  const [v, setV] = useState({ bpSys: '', bpDia: '', heartRate: '', spo2: '', pain: String(patient.painScore), notes: '' });
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [fit, setFit] = useState<'yes' | 'no'>('yes');
  const [confirms, setConfirms] = useState({ doctor: false, family: appt.familyConsent, emergency: false });
  const [issues, setIssues] = useState<string[]>([]);
  const highRisk = patient.riskLevel === '高';
  const allConfirmed = !highRisk || (confirms.doctor && confirms.family && confirms.emergency);

  const submit = async () => {
    const body = {
      vitals: {
        bpSys: Number(v.bpSys) || undefined, bpDia: Number(v.bpDia) || undefined,
        heartRate: Number(v.heartRate) || undefined, spo2: Number(v.spo2) || undefined,
        pain: Number(v.pain), notes: v.notes, extra,
      },
      fit: fit === 'yes',
      confirms,
    };
    const ok = await call(async () => {
      const r = await api<{ fit: boolean; issues: string[] }>(`/appointments/${appt.id}/checkin`, { body });
      if (r.issues?.length) setIssues(r.issues);
      return r;
    }, fit === 'yes' ? '核验通过，训练开始' : '已标记不适合当天训练并生成协同事件');
    if (ok) onClose();
  };

  return (
    <Modal wide title={<span>到场核验：{patient.name} <RiskBadge level={patient.riskLevel} /></span>} onClose={onClose}>
      <div className="note-box">
        人群评估项（{cat?.label}）：{cat?.checkinItems.join('、')}　｜　禁忌：{patient.contraindications.join('、') || '无'}
        {patient.doctorOrders && <div>医嘱：{patient.doctorOrders}</div>}
      </div>
      <div className="grid3">
        <Field label="收缩压 mmHg"><input type="number" value={v.bpSys} onChange={(e) => setV({ ...v, bpSys: e.target.value })} /></Field>
        <Field label="舒张压 mmHg"><input type="number" value={v.bpDia} onChange={(e) => setV({ ...v, bpDia: e.target.value })} /></Field>
        <Field label="疼痛评分 0-10"><input type="number" min={0} max={10} value={v.pain} onChange={(e) => setV({ ...v, pain: e.target.value })} /></Field>
        {(patient.category === 'chronic' || patient.category === 'elderly') && (
          <>
            <Field label="静息心率"><input type="number" value={v.heartRate} onChange={(e) => setV({ ...v, heartRate: e.target.value })} /></Field>
            <Field label="血氧 %"><input type="number" value={v.spo2} onChange={(e) => setV({ ...v, spo2: e.target.value })} /></Field>
          </>
        )}
        {patient.category === 'post_op' && (
          <>
            <Field label="伤口情况">
              <select value={extra['伤口情况'] || '愈合良好'} onChange={(e) => setExtra({ ...extra, 伤口情况: e.target.value })}>
                <option>愈合良好</option><option>红肿</option><option>渗液</option><option>敷料渗血</option>
              </select>
            </Field>
            <Field label="肿胀程度">
              <select value={extra['肿胀程度'] || '无'} onChange={(e) => setExtra({ ...extra, 肿胀程度: e.target.value })}>
                <option>无</option><option>轻度</option><option>中度</option><option>明显</option>
              </select>
            </Field>
          </>
        )}
        {patient.category === 'chronic' && (
          <Field label="疲劳度 0-10">
            <input type="number" min={0} max={10} value={extra['疲劳度'] || ''} onChange={(e) => setExtra({ ...extra, 疲劳度: e.target.value })} />
          </Field>
        )}
        {patient.category === 'pediatric' && (
          <>
            <Field label="情绪状态">
              <select value={extra['情绪状态'] || '平稳'} onChange={(e) => setExtra({ ...extra, 情绪状态: e.target.value })}>
                <option>平稳</option><option>兴奋</option><option>烦躁</option><option>哭闹</option>
              </select>
            </Field>
            <Field label="配合度">
              <select value={extra['配合度'] || '可配合'} onChange={(e) => setExtra({ ...extra, 配合度: e.target.value })}>
                <option>可配合</option><option>需引导</option><option>不配合</option>
              </select>
            </Field>
          </>
        )}
        {patient.category === 'elderly' && (
          <>
            <Field label="体位性血压">
              <select value={extra['体位性血压'] || '阴性'} onChange={(e) => setExtra({ ...extra, 体位性血压: e.target.value })}>
                <option>阴性</option><option>阳性</option>
              </select>
            </Field>
            <Field label="今日用药">
              <select value={extra['用药情况'] || '已按时服用'} onChange={(e) => setExtra({ ...extra, 用药情况: e.target.value })}>
                <option>已按时服用</option><option>漏服</option><option>新调整药物</option>
              </select>
            </Field>
          </>
        )}
      </div>
      {(patient.familyAccompany || cat?.family === 'required') && (
        <label className="check-row">
          <input type="checkbox" checked={extra['家属到场'] === '是'} onChange={(e) => setExtra({ ...extra, 家属到场: e.target.checked ? '是' : '否' })} />
          家属已到场陪同{cat?.family === 'required' && <Pill tone="purple">本人群必须</Pill>}
        </label>
      )}
      {highRisk && (
        <div className="confirm-block">
          <b>高风险患者训练前三项确认（缺一不可）：</b>
          <label className="check-row"><input type="checkbox" checked={confirms.doctor} onChange={(e) => setConfirms({ ...confirms, doctor: e.target.checked })} /> 已确认医生医嘱（{patient.doctorOrders || '无'}）</label>
          <label className="check-row"><input type="checkbox" checked={confirms.family} onChange={(e) => setConfirms({ ...confirms, family: e.target.checked })} /> 家属已知情{appt.familyConsent && <Pill tone="green">家属已在线确认</Pill>}</label>
          <label className="check-row"><input type="checkbox" checked={confirms.emergency} onChange={(e) => setConfirms({ ...confirms, emergency: e.target.checked })} /> 紧急联系人可联系（{patient.emergencyName} {patient.emergencyPhone}）</label>
        </div>
      )}
      <Field label="是否适合当天训练">
        <select value={fit} onChange={(e) => setFit(e.target.value as 'yes' | 'no')}>
          <option value="yes">适合，开始训练</option>
          <option value="no">不适合，取消本次（生成协同事件并改期）</option>
        </select>
      </Field>
      {fit === 'no' && <Field label="不适合原因"><input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="如：血压偏高，建议复诊" /></Field>}
      {issues.length > 0 && <AlertList items={issues} tone="amber" />}
      <div className="row-actions">
        <button className="btn btn-primary" disabled={fit === 'yes' && !allConfirmed} onClick={submit}>
          {fit === 'yes' ? '核验通过，开始训练' : '确认不适合并取消'}
        </button>
        {fit === 'yes' && !allConfirmed && <span className="muted">请先完成高风险三项确认</span>}
      </div>
    </Modal>
  );
}

/* ---------------- 训练中记录（实时风险告警） ---------------- */
function SessionForm({ appt, patient }: { appt: Appointment; patient: Patient }) {
  const { call, meta } = useStore();
  const s = appt.session || {};
  const [f, setF] = useState({
    angle: s.angle || '', resistance: s.resistance || '', reps: s.reps || '',
    heartRate: s.heartRate ? String(s.heartRate) : '', painChange: s.painChange != null ? String(s.painChange) : '0', note: s.note || '',
  });
  const [alerts, setAlerts] = useState<string[]>([]);
  const cat = meta?.categories[patient.category];
  const hrLimit = Math.round((220 - (patient.age || 60)) * (cat?.hrFactor ?? 0.75));
  const hrNum = Number(f.heartRate) || 0;
  const liveAlerts: string[] = [];
  if (hrNum > hrLimit) liveAlerts.push(`心率 ${hrNum} 超过安全阈值 ${hrLimit}，请降低强度或中止`);
  if (Number(f.painChange) >= 3) liveAlerts.push('疼痛较训练前加重≥3分，建议中止并评估');

  const save = async () => {
    await call(async () => {
      const r = await api<{ alerts: string[] }>(`/appointments/${appt.id}/session`, {
        body: { session: { angle: f.angle, resistance: f.resistance, reps: f.reps, heartRate: hrNum || undefined, painChange: Number(f.painChange) || 0, note: f.note } },
      });
      setAlerts(r.alerts || []);
    }, '训练记录已保存');
  };

  return (
    <div className="session-form">
      <div className="muted mb4">记录项（{cat?.label}）：{cat?.sessionFields.join('、')}　｜　心率安全阈值：<b>{hrLimit}</b> 次/分</div>
      <div className="grid3">
        <Field label="关节角度"><input value={f.angle} onChange={(e) => setF({ ...f, angle: e.target.value })} placeholder="如 0-95°" /></Field>
        <Field label="阻力/负荷"><input value={f.resistance} onChange={(e) => setF({ ...f, resistance: e.target.value })} placeholder="如 15Nm / 40W" /></Field>
        <Field label="次数/组数"><input value={f.reps} onChange={(e) => setF({ ...f, reps: e.target.value })} placeholder="如 3组×12次" /></Field>
        <Field label={`心率（阈值 ${hrLimit}）`}><input type="number" value={f.heartRate} onChange={(e) => setF({ ...f, heartRate: e.target.value })} /></Field>
        <Field label="疼痛变化（±分）"><input type="number" min={-5} max={10} value={f.painChange} onChange={(e) => setF({ ...f, painChange: e.target.value })} /></Field>
        <Field label="备注"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <AlertList items={[...liveAlerts, ...alerts]} tone="red" />
      <button className="btn" onClick={save}>保存训练记录</button>
    </div>
  );
}

/* ---------------- 完成训练：疗效反馈 + 下次建议 ---------------- */
function CompleteModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { call, toast } = useStore();
  const [f, setF] = useState({ effect: '略有改善', painAfter: '2', nextIntervalDays: '1', note: '' });
  const submit = async () => {
    const ok = await call(async () => {
      const r = await api<{ nextSuggestion: { date: string }; eventsCreated: string[] }>(`/appointments/${appt.id}/complete`, {
        body: { feedback: { effect: f.effect, painAfter: Number(f.painAfter), nextIntervalDays: Number(f.nextIntervalDays) || 1, note: f.note } },
      });
      if (r.eventsCreated?.length) toast('检测到训练后疼痛加重，已生成协同事件', 'err');
      toast(`已归档；建议下次训练日期：${r.nextSuggestion.date}，器械已转入消毒`, 'ok');
    });
    if (ok) onClose();
  };
  return (
    <Modal title="完成训练：疗效反馈与下次建议" onClose={onClose}>
      <div className="grid2">
        <Field label="疗效评价">
          <select value={f.effect} onChange={(e) => setF({ ...f, effect: e.target.value })}>
            <option>明显改善</option><option>略有改善</option><option>无变化</option><option>加重</option>
          </select>
        </Field>
        <Field label="训练后疼痛 0-10"><input type="number" min={0} max={10} value={f.painAfter} onChange={(e) => setF({ ...f, painAfter: e.target.value })} /></Field>
        <Field label="建议间隔（天）"><input type="number" min={1} max={14} value={f.nextIntervalDays} onChange={(e) => setF({ ...f, nextIntervalDays: e.target.value })} /></Field>
      </div>
      <Field label="备注（居家建议等）"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="muted mb4">完成后：记录归档 → 医保次数核销 → 器械转入消毒 → 疼痛≥6分自动生成协同事件与复诊提示。</div>
      <div className="row-actions"><button className="btn btn-primary" onClick={submit}>完成并归档</button></div>
    </Modal>
  );
}

function AbortModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const call = useStore((s) => s.call);
  const [reason, setReason] = useState('');
  return (
    <Modal title="异常中止" onClose={onClose}>
      <Field label="中止原因"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：训练中心率超阈值 / 患者头晕" /></Field>
      <div className="row-actions">
        <button className="btn btn-danger" onClick={async () => { if (await call(() => api(`/appointments/${appt.id}/abort`, { body: { reason } }), '已中止并生成协同事件')) onClose(); }}>确认中止</button>
      </div>
    </Modal>
  );
}

/* ---------------- 我的日程 ---------------- */
function SchedulePanel() {
  const { data, user } = useStore();
  const list = useMemo(() => (data?.appointments || [])
    .filter((a) => a.therapistId === user?.id && a.date >= todayStr())
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), [data, user]);
  if (!data) return null;
  return (
    <Section title="未来日程">
      {list.length === 0 ? <Empty /> : (
        <table className="table">
          <thead><tr><th>日期</th><th>时间</th><th>患者</th><th>器械</th><th>时长</th><th>状态</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>{a.date}</td><td>{a.start}</td><td>{a.patientName}</td><td>{a.equipmentName}</td>
                <td>{a.duration}分钟</td><td><StatusPill dict={APPT_STATUS} value={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/* ---------------- 我的患者 ---------------- */
function MyPatients() {
  const { data, user } = useStore();
  const [detailId, setDetailId] = useState<string | null>(null);
  if (!data || !user) return null;
  const mine = data.patients.filter((p) => p.therapistId === user.id);
  const others = data.patients.filter((p) => p.therapistId !== user.id);
  const row = (p: Patient) => (
    <tr key={p.id}>
      <td>{p.name}</td><td>{p.age ?? '—'}</td>
      <td>{useStore.getState().meta?.categories[p.category]?.label || p.category}</td>
      <td><RiskBadge level={p.riskLevel} /></td>
      <td className="cell-note">{p.diagnosis}</td>
      <td>{p.insuranceItems.map((it) => `${it.name}余${it.total - it.used}`).join('；') || '—'}</td>
      <td><button className="btn btn-sm" onClick={() => setDetailId(p.id)}>档案 / 计划 / 调整</button></td>
    </tr>
  );
  return (
    <Section title="我的患者（点击查看档案、计划版本链与方案调整）">
      <table className="table">
        <thead><tr><th>姓名</th><th>年龄</th><th>人群</th><th>风险</th><th>诊断</th><th>医保</th><th></th></tr></thead>
        <tbody>{mine.map(row)}</tbody>
      </table>
      {others.length > 0 && (
        <>
          <div className="muted mt8">其他患者：</div>
          <table className="table"><tbody>{others.map(row)}</tbody></table>
        </>
      )}
      {detailId && <PatientDetail patientId={detailId} onClose={() => setDetailId(null)} />}
    </Section>
  );
}

/* ---------------- 请假与排班 ---------------- */
function LeavePanel() {
  const { data, user, call } = useStore();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const me = data?.therapists.find((t) => t.id === user?.id);
  if (!data || !me) return null;
  return (
    <div className="grid2col">
      <Section title="临时请假（自动找出受影响预约并生成协同事件，由前台改派/改期）">
        <div className="grid2">
          <Field label="请假日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="事由"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：家中急事" /></Field>
        </div>
        <button className="btn btn-warn" disabled={!date} onClick={() => call(async () => {
          const r = await api<{ affected: number }>(`/therapists/${me.id}/leave`, { body: { date, reason } });
          useStore.getState().toast(`已登记请假，${r.affected} 个预约进入协同处理`, 'ok');
        })}>提交请假</button>
        <div className="mt8">
          <b>已登记请假：</b>
          {me.leaves.length === 0 ? <span className="muted">无</span> : (
            <ul className="mini-list">{me.leaves.map((l) => <li key={l.date}>{l.date}　{l.reason}</li>)}</ul>
          )}
        </div>
      </Section>
      <Section title="我的排班">
        <table className="table">
          <thead><tr><th>星期</th><th>时段</th></tr></thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 0].map((w) => {
              const schs = me.schedules.filter((s) => s.weekday === w);
              if (!schs.length) return null;
              return <tr key={w}><td>{WEEKDAYS[w]}</td><td>{schs.map((s) => `${s.start}-${s.end}`).join('，')}</td></tr>;
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
