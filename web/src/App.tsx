import { useEffect } from 'react';
import { useStore } from './store';
import Login from './pages/Login';
import FrontDesk from './pages/FrontDesk';
import Therapist from './pages/Therapist';
import PatientPage from './pages/Patient';
import FamilyPage from './pages/Family';
import MaintenancePage from './pages/Maintenance';
import { Pill } from './components/ui';

const ROLE_HOME: Record<string, () => JSX.Element> = {
  frontdesk: FrontDesk,
  therapist: Therapist,
  patient: PatientPage,
  family: FamilyPage,
  maintenance: MaintenancePage,
};

export default function App() {
  const { user, meta, loading, toasts, logout, init, dismissToast } = useStore();
  useEffect(() => { init(); }, [init]);

  if (loading) return <div className="boot">加载中…</div>;
  if (!user) return <Login />;
  const Home = ROLE_HOME[user.role] || FrontDesk;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand"><span className="brand-mark">✚</span> 社区康复中心 · 器械预约与训练风险提示</div>
        <div className="topbar-user">
          <span>{user.name}</span>
          <Pill tone="blue">{meta?.roles[user.role] || user.role}</Pill>
          <button className="btn btn-sm btn-ghost" onClick={logout}>退出</button>
        </div>
      </header>
      <main className="content">
        <Home />
      </main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
