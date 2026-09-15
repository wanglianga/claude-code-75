import db from './db.js';
import { uid, hashPassword, todayStr, addDays, nowIso } from './util.js';
import { computeRiskLevel } from './domain/risk.js';
import { PLAN_TEMPLATES } from './domain/population.js';

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const now = nowIso();
  const today = todayStr();

  /* ---------- 用户（前台/治疗师/维护/患者/家属） ---------- */
  const insUser = db.prepare('INSERT INTO users(id,username,password_hash,role,name,patient_id) VALUES(?,?,?,?,?,?)');
  const mkUser = (username, role, name, patientId = null) => {
    const id = uid();
    insUser.run(id, username, hashPassword('rehab123'), role, name, patientId);
    return id;
  };

  const frontdesk = mkUser('frontdesk', 'frontdesk', '周婷');
  const t1 = mkUser('therapist1', 'therapist', '王敏');
  const t2 = mkUser('therapist2', 'therapist', '李强');
  const t3 = mkUser('therapist3', 'therapist', '陈雪');
  mkUser('maint', 'maintenance', '赵建国');

  /* ---------- 患者档案 ---------- */
  const insPatient = db.prepare(`INSERT INTO patients(id,name,age,gender,category,diagnosis,post_op_stage,rom,contraindications,
    pain_score,family_accompany,insurance_items,therapist_id,risk_level,emergency_name,emergency_phone,doctor_orders,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const mkPatient = (p) => {
    const id = uid();
    const risk = computeRiskLevel(p);
    insPatient.run(id, p.name, p.age, p.gender, p.category, p.diagnosis, p.postOpStage || '', p.rom || '',
      JSON.stringify(p.contraindications || []), p.painScore ?? 0, p.familyAccompany ? 1 : 0,
      JSON.stringify(p.insuranceItems || []), p.therapistId, risk,
      p.emergencyName || '', p.emergencyPhone || '', p.doctorOrders || '', 'active', now);
    return { id, risk };
  };

  const p1 = mkPatient({
    name: '张伟', age: 58, gender: '男', category: 'post_op',
    diagnosis: '右膝关节置换术后', postOpStage: '术后3周', rom: '屈膝 0-95°',
    contraindications: ['深蹲超过90°', '跪姿', '膝关节扭转'], painScore: 4, familyAccompany: false,
    insuranceItems: [{ name: '运动疗法', total: 20, used: 6 }], therapistId: t1,
    emergencyName: '张强（儿子）', emergencyPhone: '13800000001',
    doctorOrders: '渐进负重，屈膝角度每周增加10°，避免扭转',
  });
  const p2 = mkPatient({
    name: '刘芳', age: 66, gender: '女', category: 'chronic',
    diagnosis: '冠心病稳定期、高血压2级', rom: '关节活动度正常',
    contraindications: ['憋气发力', '高强度间歇训练'], painScore: 2, familyAccompany: false,
    insuranceItems: [{ name: '运动疗法', total: 15, used: 12 }], therapistId: t2,
    emergencyName: '刘军（儿子）', emergencyPhone: '13800000002',
    doctorOrders: '靶心率控制在(220-年龄)×60%以下，随身携带硝酸甘油',
  });
  const p3 = mkPatient({
    name: '李小乐', age: 7, gender: '男', category: 'pediatric',
    diagnosis: '痉挛型脑瘫（轻）', rom: '双下肢肌张力偏高，踝背屈受限',
    contraindications: ['过度牵拉'], painScore: 1, familyAccompany: true,
    insuranceItems: [{ name: '儿童康复训练', total: 30, used: 9 }], therapistId: t3,
    emergencyName: '李母', emergencyPhone: '13800000003',
    doctorOrders: '以游戏化训练为主，避免疲劳与过度牵拉',
  });
  const p4 = mkPatient({
    name: '陈桂香', age: 79, gender: '女', category: 'elderly',
    diagnosis: '反复跌倒史、体位性低血压、骨质疏松', rom: '关节活动度基本正常',
    contraindications: ['快速转身', '闭眼单腿站立'], painScore: 3, familyAccompany: true,
    insuranceItems: [{ name: '平衡功能训练', total: 12, used: 3 }], therapistId: t1,
    emergencyName: '陈燕（女儿）', emergencyPhone: '13800000004',
    doctorOrders: '训练需一对一保护，监测体位性血压，防跌倒',
  });

  mkUser('patient1', 'patient', '张伟', p1.id);
  mkUser('patient2', 'patient', '刘芳', p2.id);
  mkUser('patient3', 'patient', '陈桂香', p4.id);
  mkUser('family1', 'family', '张强（张伟之子）', p1.id);
  mkUser('family2', 'family', '李母（小乐妈妈）', p3.id);
  mkUser('family3', 'family', '陈燕（陈桂香之女）', p4.id);

  /* ---------- 器械 ---------- */
  const insEquip = db.prepare('INSERT INTO equipment(id,name,type,status,suitable_categories,last_disinfected_at,note) VALUES(?,?,?,?,?,?,?)');
  const mkEquip = (name, type, status, cats, note = '') => {
    const id = uid();
    insEquip.run(id, name, type, status, JSON.stringify(cats), now, note);
    return id;
  };
  const e1 = mkEquip('等速肌力训练仪', '肌力训练', 'available', ['post_op', 'chronic']);
  const e2 = mkEquip('下肢功率车', '有氧训练', 'available', ['post_op', 'chronic', 'elderly']);
  const e3 = mkEquip('平衡训练台', '平衡训练', 'available', ['elderly', 'chronic']);
  const e4 = mkEquip('悬吊训练系统', '神经肌肉激活', 'available', ['pediatric', 'post_op']);
  mkEquip('儿童感统训练组合', '感统训练', 'maintenance', ['pediatric'], '滑梯连接件检修中，预计明日恢复');
  const e6 = mkEquip('上肢CPM机', '关节被动活动', 'available', ['post_op']);

  /* ---------- 治疗师排班 ---------- */
  const insSch = db.prepare('INSERT INTO schedules(id,therapist_id,weekday,start,end) VALUES(?,?,?,?,?)');
  const addSch = (tid, weekdays, start, end) => weekdays.forEach((w) => insSch.run(uid(), tid, w, start, end));
  addSch(t1, [1, 2, 3, 4, 5], '09:00', '12:00');
  addSch(t1, [1, 2, 3, 4, 5], '14:00', '17:00');
  addSch(t2, [1, 2, 3, 4, 5, 6], '09:00', '12:00');
  addSch(t2, [1, 2, 3, 4, 5, 6], '14:00', '17:00');
  addSch(t3, [1, 2, 3, 4, 5], '09:00', '12:00');
  addSch(t3, [1, 2, 3, 4, 5], '14:00', '17:00');
  addSch(t3, [6], '09:00', '12:00');

  /* ---------- 康复计划 v1 ---------- */
  const insPlan = db.prepare(`INSERT INTO plans(id,patient_id,version,status,goals,items,note,previous_plan_id,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const mkPlan = (patientId, goals, note) => {
    const id = uid();
    const cat = db.prepare('SELECT category FROM patients WHERE id=?').get(patientId).category;
    insPlan.run(id, patientId, 1, 'active', goals, JSON.stringify(PLAN_TEMPLATES[cat] || []), note, null, '王敏', now);
    return id;
  };
  const plan1 = mkPlan(p1.id, '恢复膝关节活动度至110°，重建股四头肌肌力', '术后3周首次评估建档');
  const plan2 = mkPlan(p2.id, '提升心肺耐力，控制血压心率风险', '心内科会诊后制定');
  const plan3 = mkPlan(p3.id, '改善下肢肌张力与步态，提升游戏参与度', '家属全程陪同');
  const plan4 = mkPlan(p4.id, '降低跌倒风险，提升静态/动态平衡能力', '高风险：一对一保护');

  /* ---------- 预约（含历史已完成） ---------- */
  const insAppt = db.prepare(`INSERT INTO appointments(id,patient_id,therapist_id,equipment_id,plan_id,insurance_item,date,start,duration,status,late,family_consent,checkin,session,feedback,risk_snapshot,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const mkAppt = (a) => {
    const id = uid();
    insAppt.run(id, a.patientId, a.therapistId, a.equipmentId, a.planId, a.insuranceItem,
      a.date, a.start, a.duration, a.status || 'scheduled', a.late ? 1 : 0, a.familyConsent ? 1 : 0,
      a.checkin ? JSON.stringify(a.checkin) : null,
      a.session ? JSON.stringify(a.session) : null,
      a.feedback ? JSON.stringify(a.feedback) : null,
      a.riskSnapshot ? JSON.stringify(a.riskSnapshot) : null, now);
    return id;
  };

  // 张伟：4天前完成一次、昨天完成一次、今天 10:00 待训练
  const apptP1Old = mkAppt({
    patientId: p1.id, therapistId: t1, equipmentId: e6, planId: plan1, insuranceItem: '运动疗法',
    date: addDays(today, -4), start: '10:00', duration: 30, status: 'completed',
    checkin: { bpSys: 130, bpDia: 84, pain: 4, extra: { 伤口情况: '愈合良好', 肿胀程度: '轻度' }, fit: true, issues: [], at: now, by: '王敏' },
    session: { angle: '0-85°', resistance: '被动', reps: '3组×10次', heartRate: 92, painChange: 0, note: '耐受良好' },
    feedback: { effect: '略有改善', painAfter: 3, nextIntervalDays: 1, note: '', at: now, by: '王敏' },
  });
  mkAppt({
    patientId: p1.id, therapistId: t1, equipmentId: e1, planId: plan1, insuranceItem: '运动疗法',
    date: addDays(today, -1), start: '10:00', duration: 45, status: 'completed',
    checkin: { bpSys: 128, bpDia: 82, pain: 4, extra: { 伤口情况: '愈合良好', 肿胀程度: '轻度' }, fit: true, issues: [], at: now, by: '王敏' },
    session: { angle: '0-90°', resistance: '15Nm', reps: '3组×12次', heartRate: 96, painChange: 1, note: '屈膝角度进展' },
    feedback: { effect: '略有改善', painAfter: 3, nextIntervalDays: 1, note: '居家踝泵练习已布置', at: now, by: '王敏' },
  });
  mkAppt({
    patientId: p1.id, therapistId: t1, equipmentId: e1, planId: plan1, insuranceItem: '运动疗法',
    date: today, start: '10:00', duration: 45, status: 'scheduled',
  });

  // 刘芳：3天前训练后疼痛6分（演示间隔拉长/风险提示），今天 09:30 待训练
  mkAppt({
    patientId: p2.id, therapistId: t2, equipmentId: e2, planId: plan2, insuranceItem: '运动疗法',
    date: addDays(today, -3), start: '09:30', duration: 40, status: 'completed',
    checkin: { bpSys: 142, bpDia: 88, heartRate: 78, spo2: 97, pain: 2, extra: { 疲劳度: '4' }, fit: true, issues: [], at: now, by: '李强' },
    session: { resistance: '40W', reps: '持续20分钟', heartRate: 108, painChange: 2, note: '末段心率偏快' },
    feedback: { effect: '无变化', painAfter: 6, nextIntervalDays: 2, note: '训练后胸闷不适，休息后缓解', at: now, by: '李强' },
  });
  mkAppt({
    patientId: p2.id, therapistId: t2, equipmentId: e2, planId: plan2, insuranceItem: '运动疗法',
    date: today, start: '09:30', duration: 40, status: 'scheduled',
  });

  // 李小乐：明天上午一次（家属陪同）
  mkAppt({
    patientId: p3.id, therapistId: t3, equipmentId: e4, planId: plan3, insuranceItem: '儿童康复训练',
    date: addDays(today, 1), start: '10:00', duration: 30, status: 'scheduled', familyConsent: true,
  });

  // 陈桂香：高风险，今天 14:30 待训练（演示训练前三项确认）
  mkAppt({
    patientId: p4.id, therapistId: t1, equipmentId: e3, planId: plan4, insuranceItem: '平衡功能训练',
    date: today, start: '14:30', duration: 40, status: 'scheduled',
  });

  /* ---------- 示例协同事件（已解决：张伟上次迟到） ---------- */
  const evId = uid();
  db.prepare(`INSERT INTO events(id,patient_id,appointment_id,plan_id,equipment_id,type,title,status,detail,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(evId, p1.id, apptP1Old, plan1, null, 'late', '张伟 训练迟到10分钟', 'resolved',
      JSON.stringify({ action: 'shorten', note: '路上堵车迟到10分钟' }), '周婷', now);
  const insStep = db.prepare('INSERT INTO event_steps(id,event_id,user_id,role,user_name,action,note,created_at) VALUES(?,?,?,?,?,?,?,?)');
  insStep.run(uid(), evId, frontdesk, 'frontdesk', '周婷', '登记迟到', '患者迟到10分钟到场，通知治疗师', now);
  insStep.run(uid(), evId, t1, 'therapist', '王敏', '缩短训练', '当次训练压缩为20分钟，保证治疗剂量', now);
  insStep.run(uid(), evId, frontdesk, 'frontdesk', '周婷', '标记解决', '已告知患者下次提前15分钟到场', now);

  console.log('[seed] 演示数据已初始化');
}
