// 训练中疼痛升级规则：分级判定、现场处置建议、下次训练强度、风险标签、家属提醒
import { CATEGORIES } from './population.js';

// 疼痛突然升高的触发阈值（NRS 变化分 / 峰值分）
export const PAIN_JUMP = 3;   // 较训练前升高 ≥3 分视为突升
export const PAIN_HIGH = 6;   // 峰值 ≥6 分需通知医生
export const PAIN_SEVERE = 8; // 峰值 ≥8 分立即停止并联系医生/急诊评估

/**
 * 疼痛升级分级
 * @param {{before:number, peak:number, change?:number}} p
 * @returns {{level:'watch'|'escalation'|'severe', change:number, reasons:string[]}}
 */
export function classifyPain({ before, peak, change }) {
  const b = Number(before) || 0;
  const pk = Number(peak) || 0;
  const ch = change != null ? Number(change) : pk - b;
  const reasons = [];
  if (pk >= PAIN_SEVERE) reasons.push(`疼痛峰值 ${pk} 分 ≥ ${PAIN_SEVERE}，属剧烈疼痛`);
  if (ch >= PAIN_JUMP) reasons.push(`疼痛较训练前突然升高 ${ch} 分（阈值 ${PAIN_JUMP}）`);
  if (pk >= PAIN_HIGH) reasons.push(`峰值疼痛 ${pk} 分 ≥ ${PAIN_HIGH}`);
  if (pk >= PAIN_SEVERE) return { level: 'severe', change: ch, reasons };
  if (ch >= PAIN_JUMP || pk >= PAIN_HIGH) return { level: 'escalation', change: ch, reasons };
  return { level: 'watch', change: ch, reasons };
}

/**
 * 现场处置建议（页面立即提示治疗师）：
 * 暂停 / 记录动作角度 / 冰敷 / 通知医生 —— 按分级给出必做项
 */
export function immediateActions({ level, change, peak }, category) {
  const joint = category === 'post_op';
  const acts = [
    { key: 'pause', required: true, label: '立即暂停当前动作', detail: '停止诱发疼痛的动作，让患者坐下/平卧休息，复测疼痛与血压心率' },
  ];
  if (joint) {
    acts.push({ key: 'angle', required: true, label: '记录诱发疼痛的动作角度', detail: '记录疼痛突升时的膝关节屈曲角度（如屈至 0-XX° 时出现），作为下次训练强度上限依据' });
  } else {
    acts.push({ key: 'angle', required: false, label: '记录当时动作/体位', detail: '记录疼痛突升时正在进行的动作、阻力与体位' });
  }
  acts.push({ key: 'ice', required: level !== 'watch' || joint, label: '局部冰敷 15-20 分钟', detail: '训练后即刻冰敷，注意隔毛巾防冻伤；记录冰敷开始时间' });
  if (level === 'severe') {
    acts.push({ key: 'doctor', required: true, label: '立即通知医生 / 急诊评估', detail: '剧烈疼痛或疼痛持续不缓解，立即电话通知值班医生，必要时转诊急诊；本次训练中止' });
  } else if (level === 'escalation' || peak >= PAIN_HIGH || change >= 4) {
    acts.push({ key: 'doctor', required: true, label: '通知医生并等待建议', detail: '疼痛≥6分或升高≥4分，训练后通知主管医生，由医生给出是否复诊/影像复查建议' });
  } else {
    acts.push({ key: 'doctor', required: false, label: '记录观察，必要时通知医生', detail: '疼痛回落且低于6分，可先观察，写入交班与下次训练注意事项' });
  }
  return acts;
}

/**
 * 依据疼痛升级结果生成「下次训练强度」建议
 * @returns {{intensity:string, intervalDays:number, tag:string|null, family:string|null}}
 */
export function nextTrainingPlan({ before, peak, change, actionAngle, category }) {
  const cfg = CATEGORIES[category] || {};
  const base = cfg.minIntervalDays || 1;
  let intensity = '维持当前强度，训练前复测疼痛';
  let intervalDays = base;
  let tag = null;
  let family = null;

  if (peak >= PAIN_SEVERE || change >= 5) {
    intensity = '暂停抗阻/屈膝加压训练，下次以无痛范围被动活动开始；角度不超过本次诱发角度，经医生评估后再进阶';
    intervalDays = Math.max(base, 3);
    tag = '疼痛高风险（训练中剧烈升高）';
    family = `本次训练中疼痛一度升至 ${peak} 分（较前 +${change}），已暂停训练并${actionAngle ? `记录诱发角度 ${actionAngle}、` : ''}冰敷处理，已通知医生。下次训练将降低强度，请家属关注居家疼痛/肿胀，出现持续剧痛及时联系中心。`;
  } else if (peak >= PAIN_HIGH || change >= PAIN_JUMP) {
    intensity = `降低阻力并限制关节活动范围（诱发角度 ${actionAngle || '见记录'} 以内），增加组间休息，疼痛≥4分即停止进阶`;
    intervalDays = Math.max(base, 2);
    tag = '疼痛敏感（升级后需降强度）';
    family = `本次训练疼痛由 ${before} 分升至 ${peak} 分，治疗师已暂停、记录动作角度并冰敷。下次训练会降低强度并控制屈膝角度，请居家留意疼痛变化。`;
  } else if (change > 0) {
    intensity = '谨慎维持：减小下次起始阻力，前 5 分钟低负荷热身，疼痛不超过本次水平方可按计划进行';
    intervalDays = base;
    family = `本次训练中疼痛有波动（峰值 ${peak} 分），已及时调整，整体可控，下次会适当降低起始强度。`;
  }
  return { intensity, intervalDays, tag, family };
}

/** 合并去重风险标签（保留历史标签，疼痛标签随最新结果更新） */
export function mergeRiskTags(oldTags = [], newTag) {
  const kept = oldTags.filter((t) => !t.startsWith('疼痛'));
  return newTag ? [...kept, newTag] : kept;
}

/** 患者维度的疼痛升级摘要（预约/交班/患者360使用） */
export function latestEscalationOf(escalations, patientId) {
  return (escalations || [])
    .filter((x) => x.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

/** 患者是否存在未进入交班知悉的疼痛升级（下次训练前必须确认） */
export function pendingHandover(escalations, patientId) {
  return (escalations || [])
    .filter((x) => x.patientId === patientId && !x.handoverAckBy && !x.closedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}
