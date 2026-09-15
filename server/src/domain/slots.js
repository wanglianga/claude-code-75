import { CATEGORIES } from './population.js';
import { todayStr, addDays, toMin, toHHMM, nowHHMM, weekdayOf } from '../util.js';

export function overlaps(aStart, aDur, bStart, bDur) {
  const a1 = toMin(aStart); const a2 = a1 + aDur;
  const b1 = toMin(bStart); const b2 = b1 + bDur;
  return a1 < b2 && b1 < a2;
}

/**
 * 可预约时段生成：
 * 依据 器械状态/适用人群、治疗师排班与请假、既有预约冲突、患者风险等级、
 * 训练时长、上一轮训练反馈（疼痛/延迟疼痛/建议间隔）综合计算。
 */
export function generateSlots({
  patient, equipment, therapistId, schedules, leaves, appointments,
  lastFeedback, escalations = [], days = 7, duration,
}) {
  const cfg = CATEGORIES[patient.category] || {};
  const dur = duration || cfg.defaultDuration || 45;
  const warnings = [];

  if (patient.status && patient.status !== 'active') {
    return { slots: [], warnings: ['患者当前处于暂停/转诊状态，不可预约'], duration: dur };
  }
  if (equipment.status !== 'available') {
    const label = { disinfecting: '消毒中', maintenance: '维护中', fault: '故障' }[equipment.status] || equipment.status;
    return { slots: [], warnings: [`器械「${equipment.name}」当前${label}，暂不可预约`], duration: dur };
  }
  if (equipment.suitableCategories && equipment.suitableCategories.length
    && !equipment.suitableCategories.includes(patient.category)) {
    warnings.push('该器械未标注适用于此人群，请治疗师评估后使用');
  }

  // 上一轮反馈决定最小间隔
  let minDate = todayStr();
  if (lastFeedback) {
    let interval = cfg.minIntervalDays ?? 1;
    if (lastFeedback.nextIntervalDays) interval = Math.max(interval, lastFeedback.nextIntervalDays);
    if ((lastFeedback.painAfter ?? 0) >= 6) {
      interval = Math.max(interval, 3);
      warnings.push('上轮训练后疼痛评分较高，已自动拉长恢复间隔');
    }
    if (lastFeedback.delayedPain && lastFeedback.delayedPain.pain >= 6) {
      interval = Math.max(interval, 3);
      warnings.push('存在延迟疼痛反馈，建议先完成复诊评估后再预约');
    }
    const candidate = addDays(lastFeedback.date, interval);
    if (candidate > minDate) minDate = candidate;
  }

  // 训练中疼痛升级：决定最小间隔，且未交班知悉时不只是「看预约状态」——明确提示下次训练前必须先阅读交班
  const escByTime = [...(escalations || [])]
    .map((x) => ({
      pain_before: x.pain_before ?? x.painBefore, pain_peak: x.pain_peak ?? x.painPeak,
      next_interval_days: x.next_interval_days ?? x.nextIntervalDays,
      next_intensity: x.next_intensity ?? x.nextIntensity,
      handover_ack_at: x.handover_ack_at ?? x.handoverAckAt, closed_at: x.closed_at ?? x.closedAt,
      appointment_id: x.appointment_id ?? x.appointmentId, created_at: x.created_at ?? x.createdAt,
    }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const lastEsc = escByTime[0];
  if (lastEsc) {
    // 优先取本次预约窗口内的预约日期，否则以升级发生日期为基准
    const escAppt = appointments.find((ap) => ap.id === lastEsc.appointment_id);
    const baseDate = escAppt?.date || String(lastEsc.created_at).slice(0, 10) || todayStr();
    const interval = Math.max(cfg.minIntervalDays ?? 1, Number(lastEsc.next_interval_days) || 1);
    const candidate = addDays(baseDate, interval);
    if (candidate > minDate) minDate = candidate;
    const acked = !!lastEsc.handover_ack_at || !!lastEsc.closed_at;
    if (!acked) {
      warnings.push(`最近一次训练中疼痛升级（${lastEsc.pain_before}→${lastEsc.pain_peak} 分）尚未完成交班知悉：下次训练核验时治疗师必须先阅读中止原因、患者主诉与医生建议，并按「${lastEsc.next_intensity || '降低强度'}」执行`);
    } else if (lastEsc.pain_peak >= 6) {
      warnings.push(`上次训练曾出现疼痛升级（峰值 ${lastEsc.pain_peak} 分），已交班知悉，下次仍建议从低强度开始`);
    }
  }

  // 医保次数提示
  const ins = (patient.insuranceItems || [])[0];
  if (ins) {
    if (ins.used >= ins.total) warnings.push(`医保项目「${ins.name}」次数已用完，继续预约将按自费处理并生成协同事件`);
    else if (ins.total - ins.used <= 2) warnings.push(`医保项目「${ins.name}」仅剩 ${ins.total - ins.used} 次，请提醒续保或确认自费`);
  }
  if (patient.riskLevel === '高') warnings.push('高风险患者：仅开放上午 9:00-11:30 与下午 14:00-16:00 时段');

  const slots = [];
  const now = nowHHMM();
  const today = todayStr();
  for (let i = 0; i < days; i += 1) {
    const d = addDays(minDate, i);
    const wd = weekdayOf(d);
    if (leaves.some((l) => l.therapist_id === therapistId && l.date === d)) continue;
    const schs = schedules.filter((s) => s.therapist_id === therapistId && s.weekday === wd);
    for (const sch of schs) {
      for (let t = toMin(sch.start); t + dur <= toMin(sch.end); t += 30) {
        const start = toHHMM(t);
        if (d === today && start <= now) continue;
        if (patient.riskLevel === '高') {
          const inMorning = t >= 9 * 60 && t + dur <= 11 * 60 + 30;
          const inAfternoon = t >= 14 * 60 && t + dur <= 16 * 60;
          if (!inMorning && !inAfternoon) continue;
        }
        const clash = appointments.some((a) => a.date === d
          && (a.therapist_id === therapistId || a.equipment_id === equipment.id)
          && overlaps(start, dur, a.start, a.duration));
        if (clash) continue;
        slots.push({ date: d, start, end: toHHMM(t + dur) });
      }
    }
  }
  return { slots, warnings, duration: dur };
}

/** 校验某治疗师在某日期时段是否可承接（改派用） */
export function therapistAvailable({ therapistId, date, start, duration, schedules, leaves, appointments }) {
  if (leaves.some((l) => l.therapist_id === therapistId && l.date === date)) return false;
  const wd = weekdayOf(date);
  const covered = schedules.some((s) => s.therapist_id === therapistId && s.weekday === wd
    && toMin(s.start) <= toMin(start) && toMin(start) + duration <= toMin(s.end));
  if (!covered) return false;
  return !appointments.some((a) => a.therapist_id === therapistId && a.date === date
    && overlaps(start, duration, a.start, a.duration));
}
