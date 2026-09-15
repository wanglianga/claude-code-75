/* 状态字典：label + 色调 */

export const APPT_STATUS: Record<string, [string, string]> = {
  scheduled: ['已预约', 'blue'],
  arrived: ['已到场', 'cyan'],
  in_progress: ['训练中', 'amber'],
  pending_reconfirm: ['待治疗师确认', 'purple'],
  completed: ['已完成', 'green'],
  aborted: ['异常中止', 'red'],
  cancelled: ['已取消', 'gray'],
};

export const EQUIP_STATUS: Record<string, [string, string]> = {
  available: ['可用', 'green'],
  disinfecting: ['消毒中', 'cyan'],
  maintenance: ['维护中', 'amber'],
  fault: ['故障', 'red'],
};

export const EVENT_STATUS: Record<string, [string, string]> = {
  open: ['待处理', 'red'],
  processing: ['处理中', 'amber'],
  resolved: ['已解决', 'green'],
};

export const PLAN_STATUS: Record<string, [string, string]> = {
  active: ['进行中', 'green'],
  paused: ['已暂停', 'amber'],
  superseded: ['已衔接新版', 'gray'],
  referred: ['已转诊', 'purple'],
  closed: ['已结束', 'gray'],
};

export const PATIENT_STATUS: Record<string, [string, string]> = {
  active: ['训练中', 'green'],
  paused: ['暂停中', 'amber'],
  referred: ['已转诊', 'purple'],
};

export const RISK_TONE: Record<string, string> = { 低: 'green', 中: 'amber', 高: 'red' };

/* 医保不足确认单状态 */
export const CONFIRM_STATUS: Record<string, [string, string]> = {
  pending_advice: ['待医生续开建议', 'amber'],
  pending_family: ['待家属确认', 'blue'],
  confirmed: ['家属已确认自费', 'green'],
  rejected: ['家属不同意自费·已暂停', 'red'],
  reopened: ['医生已重开项目', 'purple'],
};

export const BILLING_STATUS: Record<string, [string, string]> = {
  unpaid: ['待收费', 'amber'],
  paid: ['已收费', 'green'],
};

export const ORDER_STATUS: Record<string, [string, string]> = {
  open: ['待维修', 'red'],
  repairing: ['维修中', 'amber'],
  resolved: ['维修完成', 'green'],
};

export const DISINFECT_STATUS: Record<string, [string, string]> = {
  pending: ['未消毒', 'amber'],
  done: ['已消毒', 'green'],
};

export const PAY_TYPE: Record<string, [string, string]> = {
  insurance: ['医保', 'blue'],
  self_pay: ['自费', 'purple'],
};

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const fmtDT = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
