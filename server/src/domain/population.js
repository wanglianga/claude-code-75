// 人群分类配置：不同人群的风险提示、家属参与要求与治疗师评估项
export const CATEGORIES = {
  post_op: {
    key: 'post_op', label: '术后康复', defaultDuration: 45, minIntervalDays: 1, hrFactor: 0.75,
    family: 'optional',
    checkinItems: ['伤口情况', '肿胀程度', '关节活动度', '疼痛评分'],
    sessionFields: ['关节角度', '阻力', '次数/组数', '心率', '疼痛变化'],
    tips: [
      '严格避开禁忌动作，动作幅度循序渐进',
      '关注伤口渗血、红肿，异常立即中止',
      '术后早期避免负重过量',
      '训练前后评估肿胀与疼痛变化',
    ],
  },
  chronic: {
    key: 'chronic', label: '慢病功能训练', defaultDuration: 40, minIntervalDays: 1, hrFactor: 0.7,
    family: 'optional',
    checkinItems: ['血压', '静息心率', '血氧', '疲劳度'],
    sessionFields: ['阻力', '次数/组数', '心率', '血压变化', '疼痛变化'],
    tips: [
      '全程监测心率血压，超过阈值立即降低强度',
      '避免憋气发力（瓦尔萨尔瓦动作）',
      '随身携带急救药品，确认急救通道',
      '疲劳度≥7分时改为低强度训练',
    ],
  },
  pediatric: {
    key: 'pediatric', label: '儿童康复', defaultDuration: 30, minIntervalDays: 1, hrFactor: 0.8,
    family: 'required',
    checkinItems: ['情绪状态', '配合度', '睡眠情况'],
    sessionFields: ['关节角度', '阻力', '次数/组数', '配合度', '疼痛/不适表现'],
    tips: [
      '家属必须全程陪同参与',
      '训练以游戏化引导为主',
      '单次时长不超过30分钟，注意间歇',
      '哭闹或明显抗拒时及时中止',
    ],
  },
  elderly: {
    key: 'elderly', label: '老年平衡训练', defaultDuration: 40, minIntervalDays: 1, hrFactor: 0.7,
    family: 'recommended',
    checkinItems: ['跌倒史核查', '体位性血压', '平衡自评', '用药情况'],
    sessionFields: ['平衡等级', '辅助方式', '次数/组数', '心率', '疼痛变化'],
    tips: [
      '一对一防跌倒保护，器械旁全程看护',
      '避免快速体位变化，预防体位性低血压',
      '保持地面干燥、通道无障碍',
      '建议家属陪同往返与居家练习督导',
    ],
  },
};

export const EQUIPMENT_TYPES = ['肌力训练', '有氧训练', '平衡训练', '神经肌肉激活', '关节被动活动', '感统训练'];

// 协同事件类型：涉及的协同角色
export const EVENT_TYPES = {
  late: { label: '患者迟到', roles: ['frontdesk', 'therapist'] },
  family_intensity: { label: '家属要求加量', roles: ['family', 'therapist'] },
  equipment_fault: { label: '器械故障', roles: ['maintenance', 'frontdesk', 'therapist'] },
  pain_aggravation: { label: '训练后疼痛加重', roles: ['therapist', 'patient'] },
  pain_escalation: { label: '训练中疼痛升级', roles: ['therapist', 'frontdesk', 'patient', 'family'] },
  insurance_shortage: { label: '医保次数不足', roles: ['frontdesk', 'patient', 'family', 'doctor'] },
  insurance_selfpay: { label: '家属确认自费继续', roles: ['family', 'frontdesk', 'therapist'] },
  insurance_rejected: { label: '家属不同意自费·训练暂停', roles: ['family', 'doctor', 'frontdesk', 'therapist'] },
  plan_reconfirm: { label: '器械变更·计划重新确认', roles: ['therapist', 'frontdesk'] },
  therapist_leave: { label: '治疗师临时请假', roles: ['therapist', 'frontdesk'] },
  delayed_pain: { label: '延迟疼痛反馈', roles: ['patient', 'therapist'] },
  checkin_unfit: { label: '到场核验不适合训练', roles: ['therapist', 'frontdesk'] },
  abort: { label: '训练中异常中止', roles: ['therapist', 'frontdesk'] },
  plan_adjust: { label: '方案调整', roles: ['therapist'] },
  pause: { label: '暂停训练', roles: ['therapist', 'patient'] },
  referral: { label: '转诊', roles: ['therapist', 'frontdesk'] },
};

export const ROLE_LABELS = {
  frontdesk: '前台', therapist: '治疗师', patient: '患者', family: '家属', maintenance: '设备维护', doctor: '医生',
};

// 建档时按人群给出的默认计划模板
export const PLAN_TEMPLATES = {
  post_op: [
    { equipmentType: '关节被动活动', freqPerWeek: 3, duration: 30, intensity: '低强度被动活动' },
    { equipmentType: '肌力训练', freqPerWeek: 2, duration: 45, intensity: '等速低阻力' },
  ],
  chronic: [
    { equipmentType: '有氧训练', freqPerWeek: 3, duration: 40, intensity: '靶心率60-70%' },
    { equipmentType: '肌力训练', freqPerWeek: 2, duration: 30, intensity: '低阻力多次数' },
  ],
  pediatric: [
    { equipmentType: '感统训练', freqPerWeek: 3, duration: 30, intensity: '游戏化引导' },
    { equipmentType: '神经肌肉激活', freqPerWeek: 2, duration: 30, intensity: '轻阻力' },
  ],
  elderly: [
    { equipmentType: '平衡训练', freqPerWeek: 3, duration: 40, intensity: '一对一保护' },
    { equipmentType: '有氧训练', freqPerWeek: 2, duration: 30, intensity: '低强度步行/功率车' },
  ],
};
