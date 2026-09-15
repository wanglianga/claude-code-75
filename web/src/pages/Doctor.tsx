import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { InsuranceConfirmation } from '../types';
import { CONFIRM_STATUS, fmtDT } from '../labels';
import { Tabs, Section, StatusPill, Pill, Modal, Field, Empty } from '../components/ui';
import { ConfirmationDetail } from '../components/Insurance';
import { EventBoard } from '../components/Events';

/** 医生端：医保续开建议 + 暂停原因查看 + 重开项目 */
export default function DoctorPage() {
  const [tab, setTab] = useState('advice');
  const data = useStore((s) => s.data);
  const pendingAdvice = (data?.confirmations || []).filter((c) => c.status === 'pending_advice');
  const rejected = (data?.confirmations || []).filter((c) => c.status === 'rejected');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[
        ['advice', `续开建议${pendingAdvice.length ? `（${pendingAdvice.length}）` : ''}`],
        ['reopen', `暂停与重开${rejected.length ? `（${rejected.length}）` : ''}`],
        ['all', '全部确认单'],
        ['events', '协同事件'],
      ]} />
      {tab === 'advice' && <AdvicePanel />}
      {tab === 'reopen' && <ReopenPanel />}
      {tab === 'all' && <AllPanel />}
      {tab === 'events' && <EventBoard filter={(e) => ['insurance_shortage', 'insurance_rejected', 'insurance_selfpay', 'plan_adjust'].includes(e.type)} title="医保与计划相关协同事件" />}
    </div>
  );
}

/* ---------------- 续开建议（医保次数不足 → 医生填写建议 → 家属确认） ---------------- */
function AdvicePanel() {
  const { data, call } = useStore();
  const [target, setTarget] = useState<InsuranceConfirmation | null>(null);
  const [advice, setAdvice] = useState('');
  const list = useMemo(() => (data?.confirmations || []).filter((c) => c.status === 'pending_advice'), [data]);
  if (!data) return null;
  return (
    <Section title="医保次数不足 · 待填写续开建议（填写后由家属确认是否自费）">
      {list.length === 0 ? <Empty>暂无待填写建议的确认单</Empty> : (
        <table className="table">
          <thead><tr><th>患者</th><th>医保项目</th><th>剩余次数</th><th>自费价格</th><th>发起时间</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td><b>{c.patientName}</b></td>
                <td>{c.insuranceItem}</td>
                <td><Pill tone="red">仅剩 {c.remaining} 次</Pill></td>
                <td>¥{c.selfPayPrice}/次</td>
                <td>{fmtDT(c.createdAt)}</td>
                <td><button className="btn btn-sm btn-primary" onClick={() => { setTarget(c); setAdvice(''); }}>填写续开建议</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {target && (
        <Modal title={`续开建议：${target.patientName} · 「${target.insuranceItem}」剩余 ${target.remaining} 次`} onClose={() => setTarget(null)}>
          <div className="note-box">
            建议内容将展示给患者/家属与前台：家属据此确认是否自费继续训练（自费 ¥{target.selfPayPrice}/次）。
          </div>
          <Field label="续开建议">
            <textarea rows={3} value={advice} onChange={(e) => setAdvice(e.target.value)}
              placeholder="如：建议续开10次运动疗法巩固疗效；若自费困难可评估居家训练方案" />
          </Field>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={!advice.trim()} onClick={async () => {
              if (await call(() => api(`/insurance/confirmations/${target.id}/advice`, { body: { advice } }), '续开建议已提交，等待家属确认')) setTarget(null);
            }}>提交建议（转家属确认）</button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

/* ---------------- 暂停与重开（家属不同意自费 → 医生查看暂停原因 → 决定是否重开项目） ---------------- */
function ReopenPanel() {
  const { data, call } = useStore();
  const [target, setTarget] = useState<InsuranceConfirmation | null>(null);
  const [sessions, setSessions] = useState('15');
  const [note, setNote] = useState('');
  const list = useMemo(() => (data?.confirmations || []).filter((c) => c.status === 'rejected'), [data]);
  if (!data) return null;
  return (
    <Section title="家属不同意自费 · 训练已暂停（请评估是否重开项目）">
      {list.length === 0 ? <Empty>暂无待处理的暂停记录</Empty> : list.map((c) => {
        const patient = data.patients.find((p) => p.id === c.patientId);
        return (
          <div key={c.id} className="ins-conf-card">
          <div className="row-between">
              <div><b>{c.patientName}</b> · 「{c.insuranceItem}」 <StatusPill dict={CONFIRM_STATUS} value={c.status} /></div>
              <button className="btn btn-sm btn-primary" onClick={() => { setTarget(c); setSessions('15'); setNote(''); }}>重开项目</button>
            </div>
            <div className="alert-list tone-red">
              <div>⚠ 暂停训练原因：<b>{c.pauseReason}</b>（家属 {fmtDT(c.decidedAt)} 确认）</div>
            </div>
            <div className="muted">
              患者当前状态：{patient?.status === 'paused' ? <Pill tone="amber">暂停中</Pill> : patient?.status} ·
              医生建议记录：{c.doctorAdvice || '—'}
            </div>
          </div>
        );
      })}
      {target && (
        <Modal title={`重开项目：${target.patientName} · 「${target.insuranceItem}」`} onClose={() => setTarget(null)}>
          <div className="alert-list tone-amber">
            <div>⚠ 此前家属不同意自费，暂停原因：<b>{target.pauseReason}</b>。重开项目将：① 医保「{target.insuranceItem}」开启新周期；② 生成新计划版本衔接暂停前计划；③ 患者恢复可预约。</div>
          </div>
          <div className="grid2">
            <Field label="新医保周期次数"><input type="number" min={1} max={60} value={sessions} onChange={(e) => setSessions(e.target.value)} /></Field>
            <Field label="重开说明"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：新医保周期获批，继续康复" /></Field>
          </div>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={async () => {
              if (await call(() => api(`/insurance/confirmations/${target.id}/reopen`, { body: { sessions: Number(sessions) || 15, note } }), '已重开项目：新医保周期生效，计划已衔接')) setTarget(null);
            }}>确认重开项目</button>
            <button className="btn" onClick={() => setTarget(null)}>暂不处理</button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

/* ---------------- 全部确认单（含确认人/金额/治疗师说明留痕） ---------------- */
function AllPanel() {
  const data = useStore((s) => s.data);
  const list = useMemo(() => [...(data?.confirmations || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data]);
  if (!data) return null;
  return (
    <Section title="全部医保确认单（留痕可追溯）">
      {list.length === 0 ? <Empty /> : list.map((c) => <ConfirmationDetail key={c.id} c={c} showPatient />)}
    </Section>
  );
}
