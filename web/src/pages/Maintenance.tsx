import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { DISINFECT_STATUS, EQUIP_STATUS, ORDER_STATUS, fmtDT } from '../labels';
import { Tabs, Section, StatusPill, Pill, Modal, Field, Empty } from '../components/ui';
import { EventBoard } from '../components/Events';
import { EquipImpactModal } from '../components/EquipImpact';

export default function MaintenancePage() {
  const [tab, setTab] = useState('equip');
  const openOrders = (useStore((s) => s.data)?.maintenanceOrders || []).filter((o) => o.status !== 'resolved').length;
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[
        ['equip', '器械看板'],
        ['orders', `维修工单${openOrders ? `（${openOrders}）` : ''}`],
        ['events', '故障与维护事件'],
      ]} />
      {tab === 'equip' && <EquipBoard />}
      {tab === 'orders' && <OrdersPanel />}
      {tab === 'events' && <EventBoard filter={(e) => e.type === 'equipment_fault'} title="器械故障协同事件" />}
    </div>
  );
}

/* ---------------- 器械看板：上报故障（阻力异常等）→ 停用 + 工单 + 影响分析 ---------------- */
function EquipBoard() {
  const { data, call } = useStore();
  const [target, setTarget] = useState<{ id: string; status: string; label: string } | null>(null);
  const [note, setNote] = useState('');
  const [issueTarget, setIssueTarget] = useState<string | null>(null);
  const [issueType, setIssueType] = useState('阻力异常');
  const [issueDesc, setIssueDesc] = useState('');
  const [impactId, setImpactId] = useState<string | null>(null);
  if (!data) return null;
  const act = (id: string, status: string, label: string) => { setTarget({ id, status, label }); setNote(''); };
  const submit = async () => {
    if (!target) return;
    const ok = await call(() => api(`/equipment/${target.id}/status`, { body: { status: target.status, note } }),
      target.status === 'fault' ? '已登记故障并生成协同事件' : '状态已更新');
    if (ok) setTarget(null);
  };
  const openOrderOf = (eqId: string) => (data.maintenanceOrders || []).find((o) => o.equipmentId === eqId && o.status !== 'resolved');
  return (
    <Section title="器械看板（消毒 / 维护 / 故障停用 / 恢复；点击「影响分析」查看受影响预约、替代器械、工单与消毒状态）">
      <div className="equip-grid">
        {data.equipment.map((eq) => {
          const order = openOrderOf(eq.id);
          return (
            <div key={eq.id} className="equip-card">
              <div className="equip-head"><b>{eq.name}</b><StatusPill dict={EQUIP_STATUS} value={eq.status} /></div>
              <div className="muted">{eq.type} · {eq.effectDesc || '—'}</div>
              <div className="muted">最近消毒/恢复：{fmtDT(eq.lastDisinfectedAt)}</div>
              {order && (
                <div className="note-box">
                  工单：{order.issueType} <StatusPill dict={ORDER_STATUS} value={order.status} /> <StatusPill dict={DISINFECT_STATUS} value={order.disinfectionStatus} />
                </div>
              )}
              {eq.note && <div className="note-box">{eq.note}</div>}
              <div className="row-actions">
                <button className="btn btn-sm" onClick={() => setImpactId(eq.id)}>影响分析</button>
                {eq.status === 'disinfecting' && <button className="btn btn-sm btn-primary" onClick={() => act(eq.id, 'available', '消毒完成')}>消毒完成</button>}
                {eq.status === 'available' && <button className="btn btn-sm" onClick={() => act(eq.id, 'maintenance', '开始维护')}>开始维护</button>}
                {eq.status === 'maintenance' && <button className="btn btn-sm btn-primary" onClick={() => act(eq.id, 'available', '维护完成')}>维护完成</button>}
                {eq.status !== 'fault' && <button className="btn btn-sm btn-warn" onClick={() => { setIssueTarget(eq.id); setIssueType('阻力异常'); setIssueDesc(''); }}>上报故障</button>}
              </div>
            </div>
          );
        })}
      </div>
      {target && (
        <Modal title={`${target.label}：${data.equipment.find((e) => e.id === target.id)?.name}`} onClose={() => setTarget(null)}>
          <Field label="备注说明"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={target.status === 'fault' ? '故障现象（将通知前台/治疗师）' : '处理说明'} /></Field>
          <div className="row-actions">
            <button className={`btn ${target.status === 'fault' ? 'btn-danger' : 'btn-primary'}`} onClick={submit}>确认{target.label}</button>
          </div>
        </Modal>
      )}
      {issueTarget && (
        <Modal title={`上报故障：${data.equipment.find((e) => e.id === issueTarget)?.name}`} onClose={() => setIssueTarget(null)}>
          <div className="note-box">上报后器械立即停用，自动生成维修工单与协同事件；受影响预约由前台改约，替代器械效果不同需治疗师重新确认。</div>
          <Field label="故障类型">
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
              <option>阻力异常</option><option>异响</option><option>无法开机</option><option>显示异常</option><option>其他</option>
            </select>
          </Field>
          <Field label="故障描述">
            <input value={issueDesc} onChange={(e) => setIssueDesc(e.target.value)} placeholder="如：阻力输出不稳定，实测与设定值偏差>30%" />
          </Field>
          <div className="row-actions">
            <button className="btn btn-danger" onClick={async () => {
              const ok = await call(async () => {
                const r = await api<{ affected: unknown[] }>(`/equipment/${issueTarget}/report-issue`, { body: { issueType, description: issueDesc } });
                useStore.getState().toast(`已停用并生成工单，${r.affected.length} 个预约受影响`, 'err');
              }, '');
              if (ok) { setIssueTarget(null); setImpactId(issueTarget); }
            }}>确认上报并查看影响</button>
          </div>
        </Modal>
      )}
      {impactId && <EquipImpactModal equipmentId={impactId} onClose={() => setImpactId(null)} />}
    </Section>
  );
}

/* ---------------- 维修工单：开始维修 / 维修完成 / 消毒完成（双完成器械恢复可用） ---------------- */
function OrdersPanel() {
  const { data, call } = useStore();
  if (!data) return null;
  const list = [...(data.maintenanceOrders || [])].sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
  const patch = (id: string, body: Record<string, string>, msg: string) => call(() => api(`/maintenance/orders/${id}`, { method: 'PATCH', body }), msg);
  return (
    <Section title="维修工单（维修完成 + 消毒完成 → 器械自动恢复可用）">
      {list.length === 0 ? <Empty>暂无维修工单</Empty> : (
        <table className="table">
          <thead><tr><th>器械</th><th>故障类型</th><th>报修</th><th>维修状态</th><th>消毒状态</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td><b>{o.equipmentName}</b><div className="muted">{o.equipmentType}</div></td>
                <td>{o.issueType}{o.description && <div className="cell-note">{o.description}</div>}</td>
                <td>{o.reportedBy}<div className="muted">{fmtDT(o.createdAt)}</div></td>
                <td><StatusPill dict={ORDER_STATUS} value={o.status} /></td>
                <td><StatusPill dict={DISINFECT_STATUS} value={o.disinfectionStatus} /></td>
                <td>
                  <span className="row-actions">
                    {o.status === 'open' && <button className="btn btn-sm btn-warn" onClick={() => patch(o.id, { status: 'repairing' }, '已开始维修')}>开始维修</button>}
                    {o.status === 'repairing' && <button className="btn btn-sm btn-primary" onClick={() => patch(o.id, { status: 'resolved' }, '维修完成')}>维修完成</button>}
                    {o.disinfectionStatus === 'pending' && <button className="btn btn-sm" onClick={() => patch(o.id, { disinfectionStatus: 'done' }, '消毒完成')}>消毒完成</button>}
                    {o.status === 'resolved' && o.disinfectionStatus === 'done' && <Pill tone="green">已恢复可用</Pill>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
