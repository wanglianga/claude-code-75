import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { Appointment, EquipmentImpact } from '../types';
import { APPT_STATUS, DISINFECT_STATUS, ORDER_STATUS, fmtDT } from '../labels';
import { Modal, Pill, StatusPill, Field, Empty } from './ui';

/** 器械影响分析：受影响预约 / 替代器械（效果异同） / 维修工单 / 消毒状态 */
export function EquipImpactModal({ equipmentId, onClose }: { equipmentId: string; onClose: () => void }) {
  const user = useStore((s) => s.user);
  const [impact, setImpact] = useState<EquipmentImpact | null>(null);
  const [reschedAppt, setReschedAppt] = useState<Appointment | null>(null);
  const [err, setErr] = useState('');

  const load = () => {
    api<EquipmentImpact>(`/equipment/${equipmentId}/impact`)
      .then(setImpact)
      .catch((e) => setErr(e.message || '加载失败'));
  };
  useEffect(load, [equipmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Modal title="影响分析" onClose={onClose}><div className="alert-list tone-red"><div>⚠ {err}</div></div></Modal>;
  if (!impact) return <Modal title="影响分析" onClose={onClose}><div className="muted">加载中…</div></Modal>;
  const { equipment: eq, affected, alternatives, order } = impact;
  const canReschedule = user?.role === 'frontdesk';

  return (
    <Modal wide title={<span>影响分析：{eq.name} <Pill tone="red">{eq.status === 'fault' ? '故障停用' : eq.status}</Pill></span>} onClose={onClose}>
      {/* 维修工单与消毒状态 */}
      <b>维修工单与消毒状态</b>
      {order ? (
        <div className="note-box">
          工单 #{order.id.slice(0, 8)} · 故障类型 <b>{order.issueType}</b> · 报修人 {order.reportedBy} · {fmtDT(order.createdAt)}
          <div className="row-actions mt4">
            <StatusPill dict={ORDER_STATUS} value={order.status} />
            <StatusPill dict={DISINFECT_STATUS} value={order.disinfectionStatus} />
            <span className="muted">维修与消毒均完成后器械自动恢复可用</span>
          </div>
          {order.description && <div className="muted mt4">故障描述：{order.description}</div>}
        </div>
      ) : <div className="muted">当前无未结工单</div>}

      {/* 受影响预约 */}
      <b className="mt8 block">受影响预约（{affected.length}）</b>
      {affected.length === 0 ? <Empty>无受影响预约</Empty> : (
        <table className="table mt4">
          <thead><tr><th>日期时间</th><th>患者</th><th>治疗师</th><th>状态</th>{canReschedule && <th>改约</th>}</tr></thead>
          <tbody>
            {affected.map((a) => (
              <tr key={a.id}>
                <td>{a.date} {a.start}</td>
                <td>{a.patientName}</td>
                <td>{a.therapistName}</td>
                <td><StatusPill dict={APPT_STATUS} value={a.status} /></td>
                {canReschedule && (
                  <td><button className="btn btn-sm btn-primary" onClick={() => setReschedAppt(a)}>改约</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 替代器械 */}
      <b className="mt8 block">替代器械（按训练效果标注）</b>
      {alternatives.length === 0 ? <Empty>暂无可用替代器械</Empty> : (
        <div className="equip-grid mt4">
          {alternatives.map((alt) => (
            <div key={alt.id} className="equip-card">
              <div className="equip-head"><b>{alt.name}</b>
                {alt.sameEffect ? <Pill tone="green">同效果·可直接平移</Pill> : <Pill tone="amber">效果不同·需治疗师重新确认</Pill>}
              </div>
              <div className="muted">{alt.type} · {alt.effectDesc || alt.effectGroup || '—'}</div>
            </div>
          ))}
        </div>
      )}
      <div className="muted mt8">规则：替代器械训练效果相同 → 前台可直接平移预约；效果不同 → 治疗师须重新确认训练目标与动作范围后预约才生效（前台不能简单平移）。</div>

      {reschedAppt && (
        <RescheduleModal
          appt={reschedAppt}
          alternatives={alternatives}
          onClose={() => setReschedAppt(null)}
          onDone={() => { setReschedAppt(null); load(); }}
        />
      )}
    </Modal>
  );
}

/** 前台改约：选择替代器械（标注是否需要治疗师重新确认）+ 可调整日期时间 */
export function RescheduleModal({ appt, alternatives, onClose, onDone }: {
  appt: Appointment;
  alternatives: (EquipmentImpact['alternatives']);
  onClose: () => void;
  onDone: () => void;
}) {
  const { call, toast } = useStore();
  const [equipmentId, setEquipmentId] = useState('');
  const [date, setDate] = useState(appt.date);
  const [start, setStart] = useState(appt.start);
  const [resultMsg, setResultMsg] = useState('');
  const chosen = alternatives.find((a) => a.id === equipmentId);

  const submit = async () => {
    if (!equipmentId) { toast('请选择替代器械', 'err'); return; }
    const ok = await call(async () => {
      const r = await api<{ reconfirm: boolean; message?: string }>(`/appointments/${appt.id}/reschedule`, {
        body: { equipmentId, date, start },
      });
      if (r.reconfirm) {
        setResultMsg(r.message || '已提交治疗师重新确认');
        toast('替代器械训练效果不同：已挂起预约，待治疗师重新确认', 'err');
      } else {
        toast('已直接平移预约（训练效果相同）', 'ok');
      }
      return r;
    }, '');
    if (ok) onDone();
  };

  return (
    <Modal title={`改约：${appt.patientName} ${appt.date} ${appt.start}`} onClose={onClose}>
      <Field label="替代器械" hint="不同训练效果的器械需要治疗师重新确认目标与动作范围">
        <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
          <option value="">请选择</option>
          {alternatives.map((alt) => (
            <option key={alt.id} value={alt.id}>
              {alt.name}（{alt.sameEffect ? '同效果·可直接平移' : '效果不同·需治疗师重新确认'}）
            </option>
          ))}
        </select>
      </Field>
      {chosen && !chosen.sameEffect && (
        <div className="alert-list tone-amber">
          <div>⚠ 「{chosen.name}」训练效果不同（{chosen.effectDesc || chosen.effectGroup}）：提交后预约将挂起为「待治疗师确认」，治疗师重新确认训练目标与动作范围后方可执行，前台不能简单平移。</div>
        </div>
      )}
      {chosen && chosen.sameEffect && (
        <div className="note-box">「{chosen.name}」训练效果相同，可直接平移，无需治疗师重新确认。</div>
      )}
      <div className="grid2">
        <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="开始时间"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      {resultMsg && <div className="alert-list tone-amber"><div>⚠ {resultMsg}</div></div>}
      <div className="row-actions">
        <button className="btn btn-primary" disabled={!equipmentId} onClick={submit}>确认改约</button>
        <button className="btn" onClick={onClose}>取消</button>
      </div>
    </Modal>
  );
}
