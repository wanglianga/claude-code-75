import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayStr = () => fmtDate(new Date());

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

export function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function toHHMM(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function nowHHMM() {
  const d = new Date();
  return toHHMM(d.getHours() * 60 + d.getMinutes());
}

export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay(); // 0=周日
}

export function hashPassword(pw) {
  // 演示级口令散列（静态盐），生产环境应使用 bcrypt/argon2
  return crypto.createHash('sha256').update(`rehab-demo-salt:${pw}`).digest('hex');
}
