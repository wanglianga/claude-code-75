import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { Appointment, InsuranceItem } from '../types';
import { APPT_STATUS, EQUIP_STATUS, PATIENT_STATUS, todayStr } from '../labels';
import { Tabs, Section, StatusPill, Pill, RiskBadge, Modal, Field, Empty } from '../components/ui';
import { BookingWizard } from '../components/BookingWizard';
import { EventBoard } from '../components/Events';
import { PatientDetail } from '../components/PatientDetail';

export default function FrontDesk() {
  const [tab, setTab] = useState('today');
  const intent = useStore((s) => s.bookingIntent);
  useEffect(() => { if (intent) setTab('booking'); }, [intent]);
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[
        ['today', '今日日程'], ['booking', '预约训练'], ['patients', '患者建档'], ['events', '协同事件'], ['equip', '器械与医保'],
      ]} />
      {tab === 'today' && <TodayPanel />}
      {tab === 'booking' && <BookingWizard />}
      {tab === 'patients' && <IntakePanel />}
      {tab === 'events' && <EventBoard />}
      {tab === 'equip' && <EquipInsurancePanel />}
    </div>
  );
}

/* ---------------- 今日日程 ---------------- */
function TodayPanel() {
  const { data, call } = useStore();
  const [date, setDate] = useState(todayStr());
  const [lateAppt, setLateAppt] = useState<Appointment | null>(null);
  const [cancelAppt, setCancelAppt] = useState<Appointment | null>(null);
  const list = useMemo(() => (data?.appointments || [])
    .filter((a) => a.date === date)
    .sort((a, b) => a.start.localeCompare(b.start)), [data, date]);
  if (!data) return null;
  return (
    <Section title="日程与到场管理" right={<input type="date" value={date} onChange={(e) => setDate(e.target.value)} />}>
      {list.length === 0 ? <Empty>当日暂无预约</Empty> : (
        <table className="table">
          <thead><tr><th>时间</th><th>患者</th><th>人群</th><th>风险</th><th>器械</th><th>治疗师</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((a) => {
              const p = data.patients.find((x) => x.id === a.patientId);
              return (
                <tr key={a.id}>
                  <td>{a.start}（{a.duration}分钟）</td>
                  <td>{a.patientName}{a.late && <Pill tone="amber">迟到</Pill>}</td>
                  <td>{p ? <CatLabel k={p.category} /> : '—'}</td>
                  <td>{p && <RiskBadge level={p.riskLevel} />}</td>
                  <td>{a.equipmentName}</td>
                  <td>{a.therapistName}</td>
                  <td><StatusPill dict={APPT_STATUS} value={a.status} /></td>
                  <td>
                    <span className="row-actions">
                      {a.status === 'scheduled' && (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => call(() => api(`/appointments/${a.id}/arrive`, { body: {} }), '已登记到场')}>到场</button>
                          <button className="btn btn-sm btn-warn" onClick={() => setLateAppt(a)}>迟到</button>
                          <button className="btn btn-sm" onClick={() => setCancelAppt(a)}>取消</button>
                        </>
                      )}
                      {a.status === 'arrived' && <span className="muted">待治疗师核验</span>}
                      {a.status === 'in_progress' && <span className="muted">训练中…</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {lateAppt && <LateModal appt={lateAppt} onClose={() => setLateAppt(null)} />}
      {cancelAppt && <CancelModal appt={cancelAppt} onClose={() => setCancelAppt(null)} />}
    </Section>
  );
}

function LateModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const call = useStore((s) => s.call);
  const [action, setAction] = useState('shorten');
  const [note, setNote] = useState('');
  return (
    <Modal title={`迟到处理：${appt.patientName} ${appt.date} ${appt.start}`} onClose={onClose}>
      <Field label="处理方式">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="shorten">缩短当次训练（继续执行）</option>
          <option value="rebook">取消本次，改期（生成协同事件）</option>
        </select>
      </Field>
      <Field label="说明"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：迟到15分钟" /></Field>
      <div className="row-actions">
        <button className="btn btn-warn" onClick={async () => { if (await call(() => api(`/appointments/${appt.id}/late`, { body: { action, note } }), '已登记迟到并生成协同事件')) onClose(); }}>确认</button>
      </div>
    </Modal>
  );
}

function CancelModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const call = useStore((s) => s.call);
  const [reason, setReason] = useState('');
  return (
    <Modal title={`取消预约：${appt.patientName} ${appt.date} ${appt.start}`} onClose={onClose}>
      <Field label="取消原因"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：患者临时有事" /></Field>
      <div className="row-actions">
        <button className="btn btn-danger" onClick={async () => { if (await call(() => api(`/appointments/${appt.id}/cancel`, { body: { reason } }), '已取消')) onClose(); }}>确认取消</button>
      </div>
    </Modal>
  );
}

export function CatLabel({ k }: { k: string }) {
  const meta = useStore((s) => s.meta);
  return <span>{meta?.categories[k]?.label || k}</span>;
}

/* ---------------- 患者建档 ---------------- */
function IntakePanel() {
  const { data, meta, call } = useStore();
  const empty = {
    name: '', age: '', gender: '男', category: 'post_op', diagnosis: '', postOpStage: '', rom: '',
    contraindications: '', painScore: 0, familyAccompany: false, therapistId: '',
    emergencyName: '', emergencyPhone: '', doctorOrders: '', goals: '',
  };
  const [f, setF] = useState(empty);
  const [ins, setIns] = useState<InsuranceItem[]>([{ name: '运动疗法', total: 20, used: 0 }]);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (data && !f.therapistId && data.therapists.length) setF((x) => ({ ...x, therapistId: data.therapists[0].id }));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !meta) return null;
  const set = (patch: Partial<typeof empty>) => setF((x) => ({ ...x, ...patch }));

  const submit = async () => {
    if (!f.name.trim()) { useStore.getState().toast('请填写患者姓名', 'err'); return; }
    const ok = await call(() => api('/patients', {
      body: {
        name: f.name.trim(), age: Number(f.age) || null, gender: f.gender, category: f.category,
        diagnosis: f.diagnosis, postOpStage: f.postOpStage, rom: f.rom,
        contraindications: f.contraindications.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean),
        painScore: Number(f.painScore) || 0, familyAccompany: f.familyAccompany,
        insuranceItems: ins.filter((i) => i.name), therapistId: f.therapistId || null,
        emergencyName: f.emergencyName, emergencyPhone: f.emergencyPhone,
        doctorOrders: f.doctorOrders, goals: f.goals,
      },
    }), '建档成功，已生成初始康复计划');
    if (ok) { setF(empty); setIns([{ name: '运动疗法', total: 20, used: 0 }]); }
  };

  return (
    <div className="grid2col">
      <Section title="患者建档（诊断 / 术后阶段 / 活动范围 / 禁忌 / 疼痛 / 陪同 / 医保 / 治疗师）">
        <div className="grid2">
          <Field label="姓名"><input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="年龄"><input type="number" value={f.age} onChange={(e) => set({ age: e.target.value })} /></Field>
          <Field label="性别"><select value={f.gender} onChange={(e) => set({ gender: e.target.value })}><option>男</option><option>女</option></select></Field>
          <Field label="人群类别">
            <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
              {Object.values(meta.categories).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="诊断"><input value={f.diagnosis} onChange={(e) => set({ diagnosis: e.target.value })} placeholder="如：右膝关节置换术后 / 冠心病稳定期" /></Field>
        <div className="grid2">
          {f.category === 'post_op' && <Field label="术后阶段"><input value={f.postOpStage} onChange={(e) => set({ postOpStage: e.target.value })} placeholder="如：术后3周" /></Field>}
          <Field label="活动范围（ROM）"><input value={f.rom} onChange={(e) => set({ rom: e.target.value })} placeholder="如：屈膝 0-95°" /></Field>
          <Field label="疼痛评分（0-10）"><input type="number" min={0} max={10} value={f.painScore} onChange={(e) => set({ painScore: Number(e.target.value) })} /></Field>
          <Field label="负责治疗师">
            <select value={f.therapistId} onChange={(e) => set({ therapistId: e.target.value })}>
              {data.therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="禁忌动作（顿号/逗号分隔）"><input value={f.contraindications} onChange={(e) => set({ contraindications: e.target.value })} placeholder="如：深蹲超过90°、跪姿" /></Field>
        <div className="grid2">
          <Field label="紧急联系人"><input value={f.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /></Field>
          <Field label="紧急联系电话"><input value={f.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} /></Field>
        </div>
        <Field label="医生医嘱"><textarea rows={2} value={f.doctorOrders} onChange={(e) => set({ doctorOrders: e.target.value })} /></Field>
        <Field label="阶段目标"><input value={f.goals} onChange={(e) => set({ goals: e.target.value })} placeholder="如：恢复屈膝活动度至110°" /></Field>
        <label className="check-row"><input type="checkbox" checked={f.familyAccompany} onChange={(e) => set({ familyAccompany: e.target.checked })} /> 需要家属陪同训练</label>
        <b>医保项目</b>
        {ins.map((it, i) => (
          <div className="plan-item-row" key={i}>
            <input placeholder="项目名称" value={it.name} onChange={(e) => setIns((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
            <input type="number" min={0} value={it.total} onChange={(e) => setIns((arr) => arr.map((x, idx) => (idx === i ? { ...x, total: Number(e.target.value) } : x)))} title="总次数" />
            <input type="number" min={0} value={it.used} onChange={(e) => setIns((arr) => arr.map((x, idx) => (idx === i ? { ...x, used: Number(e.target.value) } : x)))} title="已用次数" />
            <button className="btn btn-sm btn-ghost" onClick={() => setIns((arr) => arr.filter((_, idx) => idx !== i))}>删</button>
          </div>
        ))}
        <div className="row-actions">
          <button className="btn btn-sm" onClick={() => setIns((arr) => [...arr, { name: '', total: 10, used: 0 }])}>+ 医保项目</button>
          <button className="btn btn-primary" onClick={submit}>保存建档</button>
        </div>
      </Section>

      <Section title="在册患者">
        <table className="table">
          <thead><tr><th>姓名</th><th>人群</th><th>风险</th><th>疼痛</th><th>医保剩余</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {data.patients.map((p) => {
              const ins0 = p.insuranceItems[0];
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><CatLabel k={p.category} /></td>
                  <td><RiskBadge level={p.riskLevel} /></td>
                  <td>{p.painScore} 分</td>
                  <td>{ins0 ? `${ins0.total - ins0.used} 次` : '—'}</td>
                  <td><StatusPill dict={PATIENT_STATUS} value={p.status} /></td>
                  <td><button className="btn btn-sm" onClick={() => setDetailId(p.id)}>查看</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {detailId && <PatientDetail patientId={detailId} onClose={() => setDetailId(null)} />}
      </Section>
    </div>
  );
}

/* ---------------- 器械与医保 ---------------- */
function EquipInsurancePanel() {
  const { data, call } = useStore();
  const [faultTarget, setFaultTarget] = useState<string | null>(null);
  const [faultNote, setFaultNote] = useState('');
  if (!data) return null;
  return (
    <div className="grid2col">
      <Section title="器械状态（故障上报后自动生成协同事件）">
        <div className="equip-grid">
          {data.equipment.map((eq) => (
            <div key={eq.id} className="equip-card">
              <div className="equip-head"><b>{eq.name}</b><StatusPill dict={EQUIP_STATUS} value={eq.status} /></div>
              <div className="muted">{eq.type} · 适用：{eq.suitableCategories.map((c) => <CatLabel key={c} k={c} />).reduce((a: React.ReactNode[], b, i) => (i ? [...a, '、', b] : [b]), [] as React.ReactNode[])}</div>
              {eq.note && <div className="note-box">{eq.note}</div>}
              {eq.status !== 'fault' && (
                <button className="btn btn-sm btn-warn" onClick={() => setFaultTarget(eq.id)}>上报故障</button>
              )}
            </div>
          ))}
        </div>
      </Section>
      <Section title="医保次数监控">
        <table className="table">
          <thead><tr><th>患者</th><th>项目</th><th>已用/总数</th><th>状态</th></tr></thead>
          <tbody>
            {data.patients.flatMap((p) => p.insuranceItems.map((it) => (
              <tr key={p.id + it.name}>
                <td>{p.name}</td>
                <td>{it.name}</td>
                <td>{it.used}/{it.total}</td>
                <td>{it.used >= it.total ? <Pill tone="red">已用完</Pill> : it.total - it.used <= 2 ? <Pill tone="amber">即将用完</Pill> : <Pill tone="green">正常</Pill>}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </Section>
      {faultTarget && (
        <Modal title="上报器械故障" onClose={() => setFaultTarget(null)}>
          <Field label="故障说明"><input value={faultNote} onChange={(e) => setFaultNote(e.target.value)} placeholder="如：皮带异响 / 无法开机" /></Field>
          <div className="row-actions">
            <button className="btn btn-danger" onClick={async () => {
              if (await call(() => api(`/equipment/${faultTarget}/status`, { body: { status: 'fault', note: faultNote } }), '已上报故障并生成协同事件')) { setFaultTarget(null); setFaultNote(''); }
            }}>确认上报</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
