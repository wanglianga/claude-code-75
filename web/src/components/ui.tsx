import type { ReactNode } from 'react';
import { RISK_TONE } from '../labels';

export function Pill({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) {
  return <span className={`pill tone-${tone}`}>{children}</span>;
}

export function RiskBadge({ level }: { level?: string }) {
  if (!level) return null;
  return <Pill tone={RISK_TONE[level] || 'gray'}>风险·{level}</Pill>;
}

export function StatusPill({ dict, value }: { dict: Record<string, [string, string]>; value?: string | null }) {
  if (!value) return null;
  const [label, tone] = dict[value] || [value, 'gray'];
  return <Pill tone={tone}>{label}</Pill>;
}

export function Modal({ title, onClose, children, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Section({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  return <div className="empty">{children || '暂无数据'}</div>;
}

export function KV({ k, children }: { k: string; children?: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{children ?? '—'}</span>
    </div>
  );
}

export function Tabs({ items, active, onChange }: {
  items: [string, string][]; active: string; onChange: (k: string) => void;
}) {
  return (
    <div className="tabs">
      {items.map(([k, label]) => (
        <button key={k} className={`tab ${active === k ? 'tab-active' : ''}`} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

export function Timeline({ items }: { items: { time: string; title: ReactNode; desc?: ReactNode; tone?: string }[] }) {
  if (!items.length) return <Empty />;
  return (
    <ul className="timeline">
      {items.map((it, i) => (
        <li key={i}>
          <span className={`tl-dot tone-${it.tone || 'blue'}`} />
          <div className="tl-body">
            <div className="tl-head"><b>{it.title}</b><span className="tl-time">{it.time}</span></div>
            {it.desc && <div className="tl-desc">{it.desc}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AlertList({ items, tone = 'red' }: { items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className={`alert-list tone-${tone}`}>
      {items.map((t, i) => <div key={i}>⚠ {t}</div>)}
    </div>
  );
}
