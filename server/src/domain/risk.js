import { CATEGORIES } from './population.js';

const HIGH_KEYWORDS = ['冠心病', '心衰', '心律', '脑梗', '脑出血', '癫痫', '骨质疏松', '主动脉', '起搏器', '慢阻肺', '肺栓塞', '糖尿病足'];
const MID_KEYWORDS = ['高血压', '糖尿病', '关节置换', '韧带', '骨折', '椎管狭窄', '帕金森', '置换术后'];

// 依据诊断、年龄、疼痛评分、人群类别计算风险等级：低 / 中 / 高
export function computeRiskLevel(p) {
  let score = 0;
  const diag = p.diagnosis || '';
  if (HIGH_KEYWORDS.some((k) => diag.includes(k))) score += 2;
  else if (MID_KEYWORDS.some((k) => diag.includes(k))) score += 1;
  const age = p.age || 0;
  if (age >= 75) score += 2;
  else if (age >= 65) score += 1;
  const pain = p.pain_score ?? p.painScore ?? 0;
  if (pain >= 7) score += 2;
  else if (pain >= 4) score += 1;
  if (p.category === 'elderly') score += 1;
  if (p.category === 'post_op' && /术后\s*[12]\s*周/.test(p.post_op_stage || '')) score += 1;
  if (score >= 4) return '高';
  if (score >= 2) return '中';
  return '低';
}

// 患者维度的风险提示（建档/预约/训练页展示）
export function riskTipsFor(p) {
  const cfg = CATEGORIES[p.category];
  const tips = (cfg ? cfg.tips : []).map((t) => ({ level: '提示', text: t }));
  if (p.contraindications && p.contraindications.length) {
    tips.unshift({ level: '禁忌', text: `禁忌动作：${p.contraindications.join('、')}` });
  }
  if (p.familyAccompany) tips.unshift({ level: '陪同', text: '需家属陪同训练，到场核验时确认家属在场' });
  if (p.riskLevel === '高' || p.risk_level === '高') {
    tips.unshift({ level: '高风险', text: '高风险患者：训练前须确认医生医嘱、家属知情与紧急联系人' });
  }
  return tips;
}

// 心率安全阈值：(220-年龄) × 人群系数
export function hrLimit(p) {
  const age = p.age || 60;
  const f = (CATEGORIES[p.category] || {}).hrFactor ?? 0.75;
  return Math.round((220 - age) * f);
}

// 到场核验评估：返回问题列表（非空表示存在风险点，治疗师可判定不适合当天训练）
export function evaluateCheckin(p, c) {
  const issues = [];
  if (c.bpSys != null && c.bpSys >= 160) issues.push(`收缩压 ${c.bpSys}mmHg ≥160，血压偏高`);
  if (c.bpDia != null && c.bpDia >= 100) issues.push(`舒张压 ${c.bpDia}mmHg ≥100，血压偏高`);
  if (c.bpSys != null && c.bpSys > 0 && c.bpSys < 90) issues.push(`收缩压 ${c.bpSys}mmHg <90，血压偏低`);
  if (c.pain != null && c.pain >= 7) issues.push(`疼痛评分 ${c.pain} 分 ≥7，疼痛较重`);
  if (c.spo2 != null && c.spo2 > 0 && c.spo2 < 94) issues.push(`血氧饱和度 ${c.spo2}% <94%`);
  if (c.heartRate != null && c.heartRate > hrLimit(p)) issues.push(`静息心率 ${c.heartRate} 超过安全阈值 ${hrLimit(p)}`);
  if (c.extra && c.extra['体位性血压'] === '阳性') issues.push('体位性低血压阳性，防跌倒');
  if (c.extra && c.extra['伤口情况'] && c.extra['伤口情况'] !== '愈合良好') issues.push(`伤口情况：${c.extra['伤口情况']}`);
  return issues;
}

// 训练中实时评估：返回告警列表
export function evaluateSession(p, s) {
  const alerts = [];
  const limit = hrLimit(p);
  if (s.heartRate != null && s.heartRate > limit) alerts.push(`心率 ${s.heartRate} 超过安全阈值 ${limit}，请降低强度或中止`);
  if ((s.painChange ?? 0) >= 3) alerts.push(`疼痛较训练前加重 ${s.painChange} 分（≥3），建议中止并评估`);
  return alerts;
}
