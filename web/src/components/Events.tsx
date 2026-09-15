import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { RehabEvent } from '../types';
import { EVENT_STATUS, fmtDT } from '../labels';
import { Modal, Pill, Section, StatusPill, Timeline, Empty } from './ui';

/** 协同事件看板：把前台、治疗师、患者、家属、设备维护放到同一康复计划中处理 */
export function EventBoard({ filter, title = '协同事件（同一康复计划内多角色协同）' }: {
  filter?: (e: RehabEvent) => boolean; title?: string;
}) {
  const data = useStore((s) => s.data);
  const meta = useStore((s) => s.meta);
  const [active, setActive] = useState<RehabEvent | null>(null);
  const events = useMemo(() => {
    const list = (data?.events || []).filter((e) => !filter || filter(e));
    const order: Record<string, number> = { open: 0, processing: 1, resolved: 2 };
    return [...list].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.createdAt.localeCompare(a.createdAt));
  }, [data, filter]);
  if (!data || !meta) return null;
  const groups: [string, RehabEvent[]][] = ['open', 'processing', 'resolved'].map((st) => [st, events.filter((e) => e.status === st)]);
  return (
    <Section title={title} right={<Pill tone="red">{events.filter((e) => e.status === 'open').length} 待处理</Pill>}>
      {events.length === 0 && <Empty>暂无协同事件</Empty>}
      <div className="event-cols">
        {groups.map(([st, list]) => (
          <div className="event-col" key={st}>
            <div className="event-col-head"><StatusPill dict={EVENT_STATUS} value={st} /><span className="muted">{list.length}</span></div>
            {list.map((e) => (
              <button key={e.id} className="event-card" onClick={() => setActive(e)}>
                <div className="event-card-top">
                  <Pill tone={e.status === 'resolved' ? 'gray' : 'blue'}>{meta.eventTypes[e.type]?.label || e.type}</Pill>
                  <span className="tl-time">{fmtDT(e.createdAt)}</span>
                </div>
                <div className="event-card-title">{e.title}</div>
                <div className="event-card-meta">
                  {e.patientName && <span>患者：{e.patientName}</span>}
                  <span>涉及角色：{(meta.eventTypes[e.type]?.roles || []).map((r) => meta.roles[r]).join('、') || '—'}</span>
                  <span>处理记录 {e.steps.length} 条</span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
      {active && <EventModal eventId={active.id} onClose={() => setActive(null)} />}
    </Section>
  );
}

export function EventModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data, meta, user, call, setBookingIntent } = useStore();
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const e = data?.events.find((x) => x.id === eventId);
  if (!e || !meta || !user || !data) return null;
  const typeCfg = meta.eventTypes[e.type];
  const isStaff = ['frontdesk', 'therapist', 'maintenance'].includes(user.role);
  const affected = (e.detail?.appointmentIds as string[] | undefined) || [];
  const affectedAppts = affected.map((id) => data.appointments.find((a) => a.id === id)).filter(Boolean);
  const linkedAppt = e.appointmentId ? data.appointments.find((a) => a.id === e.appointmentId) : null;
  const linkedEquip = e.equipmentId ? data.equipment.find((x) => x.id === e.equipmentId) : null;

  const addStep = async () => {
    if (!action.trim()) return;
    const ok = await call(() => api(`/events/${e.id}/steps`, { body: { action: action.trim(), note } }), '已记录处理动作');
    if (ok) { setAction(''); setNote(''); }
  };
  const setStatus = async (status: string) => {
    await call(() => api(`/events/${e.id}/status`, { body: { status, note } }), status === 'resolved' ? '已标记解决' : '状态已更新');
    setNote('');
  };
  const reassign = async (apptId: string) => {
    if (!reassignTo) return;
    await call(() => api(`/appointments/${apptId}/reassign`, { body: { therapistId: reassignTo } }), '已改派治疗师');
  };

  return (
    <Modal wide title={<span><Pill tone="blue">{typeCfg?.label || e.type}</Pill> <StatusPill dict={EVENT_STATUS} value={e.status} /></span>} onClose={onClose}>
      <h3 className="event-modal-title">{e.title}</h3>
      <div className="muted mb8">发起：{e.createdBy} · {fmtDT(e.createdAt)}　涉及角色：{(typeCfg?.roles || []).map((r) => meta.roles[r]).join('、')}</div>

      {e.detail?.note && <div className="note-box">{e.detail.note}</div>}
      {e.detail?.followup && <div className="alert-list tone-red"><div>⚠ 已触发复诊建议：请治疗师评估并联系患者/医生</div></div>}
      {e.detail?.handover && <div className="note-box">衔接说明：{e.detail.handover}</div>}
      {e.detail?.issues?.length > 0 && (
        <div className="alert-list tone-amber">{e.detail.issues.map((t: string, i: number) => <div key={i}>⚠ {t}</div>)}</div>
      )}
      {linkedAppt && (
        <div className="note-box">
          关联预约：{linkedAppt.date} {linkedAppt.start}（{linkedAppt.duration}分钟）· {linkedAppt.equipmentName} · 治疗师 {linkedAppt.therapistName}
        </div>
      )}
      {linkedEquip && <div className="note-box">关联器械：{linkedEquip.name}（{linkedEquip.type}）</div>}

      {affectedAppts.length > 0 && (
        <div className="mb8">
          <b>受影响预约：</b>
          <table className="table mt4">
            <thead><tr><th>日期时间</th><th>患者</th><th>器械</th><th>治疗师</th><th>状态</th>{user.role === 'frontdesk' && e.type === 'therapist_leave' && <th>改派</th>}</tr></thead>
            <tbody>
              {affectedAppts.map((a) => a && (
                <tr key={a.id}>
                  <td>{a.date} {a.start}</td>
                  <td>{a.patientName}</td>
                  <td>{a.equipmentName}</td>
                  <td>{a.therapistName}</td>
                  <td>{a.status === 'cancelled' ? '已取消' : '待调整'}</td>
                  {user.role === 'frontdesk' && e.type === 'therapist_leave' && (
                    <td>
                      {a.status !== 'cancelled' ? (
                        <span className="row-actions">
                          <select value={reassignTo} onChange={(ev) => setReassignTo(ev.target.value)}>
                            <option value="">选择治疗师</option>
                            {data.therapists.filter((t) => t.id !== a.therapistId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          <button className="btn btn-sm" onClick={() => reassign(a.id)}>改派</button>
                        </span>
                      ) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {user.role === 'frontdesk' && (
            <div className="muted mt4">提示：可在「预约训练」中为患者改期；改派/改期会自动留痕到本事件。</div>
          )}
        </div>
      )}

      <b>处理时间线：</b>
      <Timeline items={e.steps.map((s) => ({
        time: fmtDT(s.createdAt),
        title: <span><Pill tone="gray">{meta.roles[s.role] || s.role}</Pill> {s.userName} · {s.action}</span>,
        desc: s.note,
      }))} />

      <div className="step-form">
        <input placeholder="处理动作（如：联系患者/调整强度/完成消毒）" value={action} onChange={(ev) => setAction(ev.target.value)} />
        <input placeholder="备注说明" value={note} onChange={(ev) => setNote(ev.target.value)} />
        <button className="btn" onClick={addStep}>记录</button>
      </div>
      {isStaff && e.status !== 'resolved' && (
        <div className="row-actions mt8">
          {e.status === 'open' && <button className="btn btn-warn" onClick={() => setStatus('processing')}>开始处理</button>}
          <button className="btn btn-primary" onClick={() => setStatus('resolved')}>标记解决</button>
        </div>
      )}
      {e.type === 'therapist_leave' && user.role === 'frontdesk' && affectedAppts.length > 0 && (
        <button className="btn mt8" onClick={() => {
          const a = affectedAppts[0];
          if (a) { setBookingIntent({ patientId: a.patientId, equipmentId: a.equipmentId }); onClose(); }
        }}>去为受影响患者改期 →</button>
      )}
    </Modal>
  );
}
