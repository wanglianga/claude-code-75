import { useState } from 'react';
import { useStore } from '../store';

const DEMO_ACCOUNTS: [string, string][] = [
  ['frontdesk', '前台 · 周婷'],
  ['doctor', '医生 · 李医生（康复医师）'],
  ['therapist1', '治疗师 · 王敏（术后/老年）'],
  ['therapist2', '治疗师 · 李强（慢病）'],
  ['therapist3', '治疗师 · 陈雪（儿童）'],
  ['patient1', '患者 · 张伟（术后）'],
  ['patient2', '患者 · 刘芳（慢病·医保余2次）'],
  ['patient3', '患者 · 陈桂香（老年·高风险）'],
  ['family1', '家属 · 张强'],
  ['family2', '家属 · 李母（儿童）'],
  ['family3', '家属 · 陈燕（高风险患者之女）'],
  ['family4', '家属 · 刘军（刘芳之子）'],
  ['maint', '设备维护 · 赵建国'],
];

export default function Login() {
  const login = useStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username || !password) { setErr('请输入用户名和密码'); return; }
    setBusy(true); setErr('');
    try { await login(username, password); } catch (e: any) { setErr(e.message || '登录失败'); } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand"><span className="brand-mark">✚</span> 社区康复中心</div>
        <div className="brand-sub">器械预约与训练风险提示系统</div>
        <label className="field">
          <span className="field-label">用户名</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">密码</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="演示账号统一为 rehab123"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        </label>
        {err && <div className="alert-list tone-red"><div>⚠ {err}</div></div>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>{busy ? '登录中…' : '登 录'}</button>
        <div className="demo-accounts">
          <div className="muted">演示账号（点击填充，密码均为 rehab123）：</div>
          <div className="account-chips">
            {DEMO_ACCOUNTS.map(([u, label]) => (
              <button key={u} className="chip" onClick={() => { setUsername(u); setPassword('rehab123'); }}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
