import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { Appointment, Patient, PainEscalation } from '../types';
import { fmtDT } from '../labels';
import { Modal, Pill, Field, Empty, Section } from './ui';

/* 疼痛升级分级（与 server/src/domain/pain.js 阈值保持一致，仅用于页面即时提示） */
export const PAIN_JUMP = 3;
export const PAIN_HIGH = 6;
export const PAIN_SEVERE = 8;

export function classifyPain(before: number, peak: number) {
  const change = peak - before;
  if (peak >= PAIN_SEVERE) return { level: 'severe' as const, change, label: '剧烈疼痛', tone: 'red' };
  if (change >= PAIN_JUMP || peak >= PAIN_HIGH) return { level: 'escalation' as const, change, label: '疼痛升级', tone: 'red' };
  return { level: 'watch' as const, change, label: '疼痛波动', tone: 'amber' };
}

export function RiskTags({ patient }: { patient: Patient }) {
  if (!patient.riskTags?.length) return null;
  return (
    <span className="risk-tags">
      {patient.riskTags.map((t) => <Pill key={t} tone="red">⚠ {t}</Pill>)}
    </span>
  );
}

export function usePatientEscalations(patientId: string) {
  const data = useStore((s) => s.data);
  return useMemo(() => (data?.escalations || [])
    .filter((x) => x.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data, patientId]);
}

/** 未交班知悉的最近一次疼痛升级（下次训练前必须确认） */
export function usePendingHandover(patientId: string) {
  const list = usePatientEscalations(patientId);
  return list.find((x) => !x.handoverAckAt && !x.closedAt) || null;
}

/* ---------------- 训练中：疼痛突然升高的现场引导条 ---------------- */
export function PainJumpBanner({ appt, patient, onOpen }: { appt: Appointment; patient: Patient; onOpen: (peak: number) => void }) {
  const checkinPain = appt.checkin?.pain ?? patient.painScore;
  const [peak, setPeak] = useState('');
  const change = Number(peak) - Number(checkinPain || 0);
  const jump = peak !== '' && (change >= PAIN_JUMP || Number(peak) >= PAIN_HIGH);
  return (
    <div className="pain-jump">
      <div className="pain-jump-head">
        <b>疼痛突然升高？立即按流程处置</b>
        <span className="muted">训练前疼痛 {checkinPain ?? '—'} 分</span>
      </div>
      <div className="pain-jump-actions">
        <span>① 暂停当前动作</span>
        <span>② 记录诱发动作角度{patient.category === 'post_op' ? '（膝关节屈曲角度）' : ''}</span>
        <span>③ 局部冰敷 15-20 分钟</span>
        <span>④ {Number(peak) >= PAIN_HIGH ? '通知医生/必要时中止' : '评估是否通知医生'}</span>
      </div>
      <div className="pain-jump-entry">
        <Field label={`患者当前疼痛峰值 0-10（训练前 ${checkinPain ?? '—'} 分）`}>
          <input type="number" min={0} max={10} value={peak} onChange={(e) => setPeak(e.target.value)} style={{ width: 90 }} />
        </Field>
        <button className="btn btn-danger" disabled={!jump} onClick={() => onOpen(Number(peak))}>
          {jump ? '填写疼痛升级处理单（暂停/角度/冰敷/通知医生）' : '填写疼痛升级处理单'}
        </button>
        {jump && <Pill tone="red">{classifyPain(Number(checkinPain || 0), Number(peak)).label}，处理结果将进入交班并影响下次训练强度</Pill>}
      </div>
    </div>
  );
}

/* ---------------- 疼痛升级处理单（治疗师训练中填写） ---------------- */
export function PainEscalationModal({ appt, patient, defaultPeak, onClose }: {
  appt: Appointment; patient: Patient; defaultPeak?: number | string; onClose: () => void;
}) {
  const { call, toast } = useStore();
  const before0 = appt.checkin?.pain ?? patient.painScore;
  const [phase, setPhase] = useState<'form' | 'done'>('form');
  const [result, setResult] = useState<any>(null);

  const [painBefore, setPainBefore] = useState(String(before0 ?? 0));
  const [painPeak, setPainPeak] = useState(defaultPeak != null ? String(defaultPeak) : '');
  const [words, setWords] = useState('');
  const [angle, setAngle] = useState(appt.session?.angle || '');
  const [pause, setPause] = useState(true);
  const [ice, setIce] = useState(true);
  const [notifyDoctor, setNotifyDoctor] = useState(true);
  const [notifyFamily, setNotifyFamily] = useState(true);

  // 提交后的可调整结果
  const [nextIntensity, setNextIntensity] = useState('');
  const [nextInterval, setNextInterval] = useState(3);
  const [familyOn, setFamilyOn] = useState(true);

  const cls = painPeak !== '' ? classifyPain(Number(painBefore) || 0, Number(painPeak)) : null;

  const submit = async () => {
    const b = Number(painBefore); const pk = Number(painPeak);
    if (!(pk >= 0 && pk <= 10) || !(b >= 0 && b <= 10)) { toast('疼痛评分需为 0-10', 'err'); return; }
    if (pk < b) { toast('疼痛升级要求峰值不低于训练前评分', 'err'); return; }
    const ok = await call(async () => {
      const r = await api(`/appointments/${appt.id}/pain-escalation`, {
        body: {
          painBefore: b, painPeak: pk, patientWords: words, actionAngle: angle,
          actions: { pause, ice, notifyDoctor },
          notifyFamily,
        },
      });
      setResult(r);
      setNextIntensity(r.nextIntensity);
      setNextInterval(r.nextIntervalDays);
      setFamilyOn(r.familyMessage ? true : false);
      setPhase('done');
      return r;
    }, '');
    if (ok) toast('疼痛升级已记录并进入治疗师交班，风险标签与下次训练强度已更新', 'err');
  };

  const saveAdjust = () => call(() => api(`/escalations/${result.escalation.id}`, {
    method: 'PATCH',
    body: { nextIntensity, nextIntervalDays: nextInterval, notifyFamily: familyOn },
  }), '交班内容已更新');

  return (
    <Modal wide onClose={onClose} title={<span>训练中疼痛升级处理单 · {patient.name} <Pill tone="blue">{appt.date} {appt.start}</Pill></span>}>
      {phase === 'form' ? (
        <>
          <div className="note-box">
            流程：① 暂停诱发动作 → ② 记录动作角度（膝关节屈曲到多少度时出现）→ ③ 冰敷 → ④ 通知医生；
            处理结果会影响<b>下次训练强度、家属提醒与风险标签</b>，并自动进入<b>治疗师交班</b>。
          </div>
          <div className="grid3">
            <Field label="训练前疼痛 0-10"><input type="number" min={0} max={10} value={painBefore} onChange={(e) => setPainBefore(e.target.value)} /></Field>
            <Field label="疼痛峰值 0-10"><input type="number" min={0} max={10} value={painPeak} onChange={(e) => setPainPeak(e.target.value)} /></Field>
            <Field label="升高幅度">
              <div className="pain-change-box">
                {cls ? <Pill tone={cls.tone}>{cls.label} +{cls.change} 分</Pill> : <span className="muted">填写峰值后自动判定</span>}
              </div>
            </Field>
          </div>
          {cls?.level === 'severe' && (
            <div className="alert-list tone-red"><div>⚠ 剧烈疼痛（≥8 分）：立即停止训练、通知医生/急诊评估，本次训练应中止。</div></div>
          )}
          {cls?.level === 'escalation' && (
            <div className="alert-list tone-amber"><div>⚠ 疼痛突然升高 ≥{PAIN_JUMP} 分或峰值 ≥{PAIN_HIGH} 分：暂停处置并通知医生，处理后进入交班。</div></div>
          )}
          <Field label="患者主观描述（原话）">
            <textarea rows={2} value={words} onChange={(e) => setWords(e.target.value)} placeholder="如：膝盖里面突然刺痛，不敢再弯 / 胀得发紧" />
          </Field>
          <div className="grid2">
            <Field label={patient.category === 'post_op' ? '诱发疼痛的膝关节角度' : '诱发疼痛的动作/体位'}>
              <input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={patient.category === 'post_op' ? '如：屈膝约92°' : '如：功率车阻力第4档蹬伸时'} />
            </Field>
            <div className="pain-checks">
              <label className="check-row"><input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} /> ① 已暂停当前动作</label>
              <label className="check-row"><input type="checkbox" checked={ice} onChange={(e) => setIce(e.target.checked)} /> ③ 已局部冰敷 15-20 分钟</label>
              <label className="check-row"><input type="checkbox" checked={notifyDoctor} onChange={(e) => setNotifyDoctor(e.target.checked)} /> ④ 已通知医生（医生建议稍后可在交班中回填）</label>
              <label className="check-row"><input type="checkbox" checked={notifyFamily} onChange={(e) => setNotifyFamily(e.target.checked)} /> 同步家属提醒</label>
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-danger" onClick={submit}>确认记录并进入交班</button>
            <span className="muted">记录后仍可在「交班记录」中补录医生建议、调整下次强度</span>
          </div>
        </>
      ) : (
        <PainEscalationResult result={result} familyOn={familyOn} setFamilyOn={setFamilyOn}
          nextIntensity={nextIntensity} setNextIntensity={setNextIntensity}
          nextInterval={nextInterval} setNextInterval={setNextInterval}
          onSave={saveAdjust} onClose={onClose} />
      )}
    </Modal>
  );
}

function PainEscalationResult({ result, familyOn, setFamilyOn, nextIntensity, setNextIntensity, nextInterval, setNextInterval, onSave, onClose }: {
  result: any; familyOn: boolean; setFamilyOn: (v: boolean) => void;
  nextIntensity: string; setNextIntensity: (v: string) => void;
  nextInterval: number; setNextInterval: (v: number) => void;
  onSave: () => Promise<boolean>; onClose: () => void;
}) {
  return (
    <div>
      <div className="alert-list tone-red">
        {result.classification.reasons.map((r: string, i: number) => <div key={i}>⚠ {r}</div>)}
      </div>
      <b>现场处置清单</b>
      <ul className="tip-list">
        {result.immediateActions.map((a: any) => (
          <li key={a.key}><b>{a.required ? '【必做】' : '【建议】'}{a.label}</b>：{a.detail}</li>
        ))}
      </ul>
      <div className="grid2 mt8">
        <Field label="下次训练强度建议（将带入下次预约与交班）">
          <textarea rows={3} value={nextIntensity} onChange={(e) => setNextIntensity(e.target.value)} />
        </Field>
        <div>
          <Field label="建议间隔（天）"><input type="number" min={1} max={14} value={nextInterval} onChange={(e) => setNextInterval(Number(e.target.value))} style={{ width: 90 }} /></Field>
          {result.riskTagAdded && <div className="mt8"><Pill tone="red">已加风险标签：{result.riskTagAdded}</Pill></div>}
        </div>
      </div>
      {result.familyMessage && (
        <div className="mt8">
          <label className="check-row"><input type="checkbox" checked={familyOn} onChange={(e) => setFamilyOn(e.target.checked)} /> 向家属推送提醒</label>
          {familyOn && <div className="note-box">家属提醒内容：{result.familyMessage}</div>}
        </div>
      )}
      <div className="muted mt8">该事件已进入治疗师交班：下一位治疗师在下次训练核验时必须先阅读疼痛评分变化、患者主观描述、中止原因与医生建议，不会只看预约状态。</div>
      <div className="row-actions mt8">
        <button className="btn btn-primary" onClick={async () => { if (await onSave()) onClose(); }}>保存交班内容</button>
        <button className="btn" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

/* ---------------- 交班卡片（治疗师核验时强制阅读知悉） ---------------- */
export function HandoverCard({ esc, ack, setAck, note, setNote }: {
  esc: PainEscalation; ack: boolean; setAck: (v: boolean) => void;
  note?: string; setNote?: (v: string) => void;
}) {
  return (
    <div className="handover-card">
      <div className="handover-head">
        <b>⚠ 疼痛升级交班（来自 {esc.therapistName} · {fmtDT(esc.createdAt)}）</b>
        <Pill tone="red">下次训练前必须知悉</Pill>
      </div>
      <table className="table mt4">
        <tbody>
          <tr><th style={{ width: 110 }}>疼痛评分变化</th><td>{esc.painBefore} → <b className="pain-num">{esc.painPeak}</b> 分（+{esc.painChange}）</td></tr>
          <tr><th>患者主观描述</th><td>{esc.patientWords || '—'}</td></tr>
          <tr><th>中止/暂停原因</th><td>{esc.actionAngle ? `诱发角度：${esc.actionAngle}` : '—'}；暂停：{esc.actionPause ? '是' : '否'}；冰敷：{esc.actionIce ? '是' : '否'}</td></tr>
          <tr><th>现场处置</th><td>通知医生：{esc.actionNotifyDoctor ? '是' : '否'}；家属提醒：{esc.notifyFamily ? '已发送' : '未发送'}</td></tr>
          <tr><th>医生建议</th><td>{esc.doctorAdvice ? <b>{esc.doctorAdvice}</b> : <span className="muted">暂无，治疗师可在「交班记录」中回填</span>}{esc.doctorAdviceBy && <div className="muted">来源：{esc.doctorAdviceBy}</div>}</td></tr>
          <tr><th>下次训练强度</th><td><b>{esc.nextIntensity}</b>（建议间隔 {esc.nextIntervalDays ?? '—'} 天）</td></tr>
        </tbody>
      </table>
      <label className="check-row mt8">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        我是本次训练的治疗师，已知悉上述交班内容（疼痛变化、患者主诉、中止原因、医生建议），将按建议降低强度执行
      </label>
      {setNote && (
        <input placeholder="交班备注（可选，如：今日复测疼痛2分，无肿胀）" value={note || ''} onChange={(e) => setNote(e.target.value)} />
      )}
    </div>
  );
}

/* ---------------- 治疗师交班记录面板 ---------------- */
export function HandoverPanel() {
  const { data, user, call } = useStore();
  const [adviceFor, setAdviceFor] = useState<string | null>(null);
  const [advice, setAdvice] = useState('');
  const [ackNote, setAckNote] = useState<Record<string, string>>({});
  const [resolveTag, setResolveTag] = useState<Record<string, boolean>>({});
  if (!data || !user) return null;

  const list = [...data.escalations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = list.filter((x) => !x.handoverAckAt);

  return (
    <div>
      <Section title={`治疗师交班 · 疼痛升级（${pending.length} 条待知悉）`} right={<Pill tone={pending.length ? 'red' : 'green'}>{pending.length ? `${pending.length} 条待下一位治疗师知悉` : '全部已交接'}</Pill>}>
        <div className="muted mb8">交班记录携带疼痛评分变化、患者主观描述、中止原因、现场处置与医生建议；下一次训练核验时系统强制下一位治疗师阅读知悉，不会只看预约状态。</div>
        {list.length === 0 && <Empty>暂无疼痛升级交班记录</Empty>}
        <div className="handover-list">
          {list.map((esc) => {
            return (
              <div key={esc.id} className={`handover-item ${esc.handoverAckAt ? 'is-done' : 'is-pending'}`}>
                <div className="handover-item-head">
                  <b>{esc.patientName}</b>
                  <Pill tone="blue">{esc.date} {esc.start}</Pill>
                  <Pill tone="gray">{esc.equipmentName}</Pill>
                  <span className="pain-change"><b>{esc.painBefore}</b> → <b className="pain-num">{esc.painPeak}</b> 分（+{esc.painChange}）</span>
                  {esc.handoverAckAt
                    ? <Pill tone="green">已由 {esc.handoverAckName} 知悉 · {fmtDT(esc.handoverAckAt)}</Pill>
                    : <Pill tone="red">待交班知悉</Pill>}
                </div>
                <div className="handover-grid">
                  <div><span className="muted">患者主诉：</span>{esc.patientWords || '—'}</div>
                  <div><span className="muted">诱发角度：</span>{esc.actionAngle || '—'}</div>
                  <div><span className="muted">处置：</span>暂停{esc.actionPause ? '✓' : '✗'} · 冰敷{esc.actionIce ? '✓' : '✗'} · 通知医生{esc.actionNotifyDoctor ? '✓' : '✗'} · 家属提醒{esc.notifyFamily ? '✓' : '✗'}</div>
                  <div><span className="muted">交班治疗师：</span>{esc.therapistName} · {fmtDT(esc.createdAt)}</div>
                </div>
                <div className="note-box"><b>下次训练强度：</b>{esc.nextIntensity}（建议间隔 {esc.nextIntervalDays ?? '—'} 天）</div>
                {esc.doctorAdvice
                  ? <div className="note-box doctor-advice"><b>医生建议：</b>{esc.doctorAdvice}{esc.doctorAdviceBy && <span className="muted">（{esc.doctorAdviceBy}）</span>}</div>
                  : (
                    adviceFor === esc.id ? (
                      <div className="doctor-advice-form">
                        <Field label="录入医生建议（将进入交班与下次核验）">
                          <textarea rows={2} value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="如：暂停抗阻3天，屈膝不超过90°，3天后复评" />
                        </Field>
                        <div className="row-actions">
                          <button className="btn btn-sm btn-primary" onClick={async () => {
                            if (await call(() => api(`/escalations/${esc.id}/doctor-advice`, { body: { advice } }), '医生建议已录入交班')) { setAdviceFor(null); setAdvice(''); }
                          }}>保存医生建议</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setAdviceFor(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-sm" disabled={!!esc.handoverAckAt} onClick={() => setAdviceFor(esc.id)}>录入/补充医生建议</button>
                    )
                  )}
                {!esc.handoverAckAt && (
                  <div className="handover-ack">
                    <input placeholder="知悉备注（可选）" value={ackNote[esc.id] || ''} onChange={(e) => setAckNote({ ...ackNote, [esc.id]: e.target.value })} />
                    <label className="check-row"><input type="checkbox" checked={!!resolveTag[esc.id]} onChange={(e) => setResolveTag({ ...resolveTag, [esc.id]: e.target.checked })} /> 患者已恢复，同时解除疼痛风险标签</label>
                    <button className="btn btn-sm btn-primary" onClick={() => call(() => api(`/escalations/${esc.id}/handover`, {
                      body: { note: ackNote[esc.id] || '', resolveTag: !!resolveTag[esc.id] },
                    }), '已确认交班知悉')}>我是下一位治疗师，已知悉</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

/* 患者/家属端：疼痛升级后的提醒（评分变化、处置、医生建议、下次强度） */
export function PainEscalationNotice({ patientId }: { patientId: string }) {
  const list = usePatientEscalations(patientId);
  const recent = list.filter((x) => x.notifyFamily).slice(0, 2);
  if (!recent.length) return null;
  return (
    <div className="alert-list tone-amber">
      {recent.map((esc) => (
        <div key={esc.id}>
          ⚠ {esc.date} 训练中疼痛由 {esc.painBefore} 分升至 {esc.painPeak} 分，治疗师已暂停、记录角度（{esc.actionAngle || '—'}）并冰敷处理，{esc.actionNotifyDoctor ? '已通知医生' : '持续观察'}。
          下次训练将按更低强度进行（{esc.nextIntensity}）；请居家留意疼痛/肿胀，若出现持续剧痛请及时联系中心。
          {esc.doctorAdvice && <div className="mt4">医生建议：{esc.doctorAdvice}</div>}
        </div>
      ))}
    </div>
  );
}
