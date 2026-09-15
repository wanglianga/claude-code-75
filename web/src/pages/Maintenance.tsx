import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { EQUIP_STATUS, fmtDT } from '../labels';
import { Tabs, Section, StatusPill, Modal, Field } from '../components/ui';
import { EventBoard } from '../components/Events';

export default function MaintenancePage() {
  const [tab, setTab] = useState('equip');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} items={[['equip', '器械看板'], ['events', '故障与维护事件']]} />
      {tab === 'equip' && <EquipBoard />}
      {tab === 'events' && <EventBoard filter={(e) => e.type === 'equipment_fault'} title="器械故障协同事件" />}
    </div>
  );
}

function EquipBoard() {
  const { data, call } = useStore();
  const [target, setTarget] = useState<{ id: string; status: string; label: string } | null>(null);
  const [note, setNote] = useState('');
  if (!data) return null;
  const act = (id: string, status: string, label: string) => { setTarget({ id, status, label }); setNote(''); };
  const submit = async () => {
    if (!target) return;
    const ok = await call(() => api(`/equipment/${target.id}/status`, { body: { status: target.status, note } }),
      target.status === 'fault' ? '已登记故障并生成协同事件' : '状态已更新');
    if (ok) setTarget(null);
  };
  return (
    <Section title="器械看板（消毒 / 维护 / 故障 / 恢复）">
      <div className="equip-grid">
        {data.equipment.map((eq) => (
          <div key={eq.id} className="equip-card">
            <div className="equip-head"><b>{eq.name}</b><StatusPill dict={EQUIP_STATUS} value={eq.status} /></div>
            <div className="muted">{eq.type}</div>
            <div className="muted">最近消毒/恢复：{fmtDT(eq.lastDisinfectedAt)}</div>
            {eq.note && <div className="note-box">{eq.note}</div>}
            <div className="row-actions">
              {eq.status === 'disinfecting' && <button className="btn btn-sm btn-primary" onClick={() => act(eq.id, 'available', '消毒完成')}>消毒完成</button>}
              {eq.status === 'available' && <button className="btn btn-sm" onClick={() => act(eq.id, 'maintenance', '开始维护')}>开始维护</button>}
              {eq.status === 'maintenance' && <button className="btn btn-sm btn-primary" onClick={() => act(eq.id, 'available', '维护完成')}>维护完成</button>}
              {eq.status === 'fault' && <button className="btn btn-sm btn-primary" onClick={() => act(eq.id, 'available', '修复完成')}>修复完成</button>}
              {eq.status !== 'fault' && <button className="btn btn-sm btn-warn" onClick={() => act(eq.id, 'fault', '登记故障')}>登记故障</button>}
            </div>
          </div>
        ))}
      </div>
      {target && (
        <Modal title={`${target.label}：${data.equipment.find((e) => e.id === target.id)?.name}`} onClose={() => setTarget(null)}>
          <Field label="备注说明"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={target.status === 'fault' ? '故障现象（将通知前台/治疗师）' : '处理说明'} /></Field>
          <div className="row-actions">
            <button className={`btn ${target.status === 'fault' ? 'btn-danger' : 'btn-primary'}`} onClick={submit}>确认{target.label}</button>
          </div>
        </Modal>
      )}
    </Section>
  );
}
