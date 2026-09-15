/* ---------------- 与后端 API 对应的类型 ---------------- */

export type Role = 'frontdesk' | 'therapist' | 'patient' | 'family' | 'maintenance';

export interface User {
  id: string;
  username: string;
  role: Role;
  name: string;
  patientId: string | null;
}

export interface InsuranceItem {
  name: string; total: number; used: number;
  selfPayPrice?: number; selfPayTotal?: number; selfPayUsed?: number;
}

export interface Patient {
  id: string;
  name: string;
  age: number | null;
  gender: string;
  category: string;
  diagnosis: string;
  postOpStage: string;
  rom: string;
  contraindications: string[];
  painScore: number;
  familyAccompany: boolean;
  insuranceItems: InsuranceItem[];
  therapistId: string | null;
  riskLevel: string;
  emergencyName: string;
  emergencyPhone: string;
  doctorOrders: string;
  riskTags: string[];
  status: string;
  createdAt: string;
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
  status: string;
  suitableCategories: string[];
  lastDisinfectedAt: string | null;
  note: string;
  effectGroup: string;
  effectDesc: string;
}

export interface PlanItem { equipmentType: string; freqPerWeek: number; duration: number; intensity: string }

export interface Plan {
  id: string;
  patientId: string;
  version: number;
  status: string;
  goals: string;
  items: PlanItem[];
  note: string;
  rom: string;
  estimatedSessions: number | null;
  patientReminder: string;
  previousPlanId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Checkin {
  bpSys?: number; bpDia?: number; heartRate?: number; spo2?: number; pain?: number;
  extra?: Record<string, string>;
  fit: boolean; issues?: string[]; notes?: string;
  confirms?: { doctor?: boolean; family?: boolean; emergency?: boolean };
  familyConsentOnline?: boolean;
  at?: string; by?: string;
}

export interface SessionRec {
  angle?: string; resistance?: string; reps?: string; heartRate?: number;
  painChange?: number; note?: string; aborted?: boolean; abortReason?: string;
  painEscalation?: {
    id: string | null; before: number; peak: number; change: number;
    patientWords?: string; actionAngle?: string; at?: string;
  };
  updatedAt?: string; by?: string;
}

export interface PainEscalation {
  id: string;
  patientId: string;
  appointmentId: string;
  therapistId: string;
  painBefore: number;
  painPeak: number;
  painChange: number;
  patientWords: string;
  actionPause: boolean;
  actionAngle: string;
  actionIce: boolean;
  actionNotifyDoctor: boolean;
  notifyFamily: boolean;
  nextIntensity: string;
  nextIntervalDays: number | null;
  doctorAdvice: string;
  doctorAdviceBy: string;
  doctorAdviceAt: string | null;
  handoverAckBy: string | null;
  handoverAckName: string;
  handoverAckAt: string | null;
  closedAt: string | null;
  closedBy: string;
  createdAt: string;
  patientName?: string;
  therapistName?: string;
  date?: string;
  start?: string;
  equipmentName?: string;
}

export interface DelayedPain { pain: number; note: string; at: string }

export interface Feedback {
  effect?: string; painAfter?: number; nextIntervalDays?: number; note?: string;
  at?: string; by?: string; delayedPain?: DelayedPain;
  cancelReason?: string; cancelledBy?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  therapistId: string;
  equipmentId: string;
  planId: string | null;
  insuranceItem: string | null;
  date: string;
  start: string;
  duration: number;
  status: string;
  late: boolean;
  familyConsent: boolean;
  payType: string;
  checkin: Checkin | null;
  session: SessionRec | null;
  feedback: Feedback | null;
  riskSnapshot: { riskLevel: string; tips: { level: string; text: string }[] } | null;
  createdAt: string;
  patientName?: string;
  therapistName?: string;
  equipmentName?: string;
}

export interface EventStep {
  id: string;
  eventId: string;
  role: string;
  userName: string;
  action: string;
  note: string;
  createdAt: string;
}

export interface RehabEvent {
  id: string;
  patientId: string | null;
  appointmentId: string | null;
  planId: string | null;
  equipmentId: string | null;
  type: string;
  title: string;
  status: string;
  detail: Record<string, any>;
  createdBy: string;
  createdAt: string;
  patientName: string | null;
  steps: EventStep[];
}

export interface TherapistInfo {
  id: string;
  name: string;
  schedules: { weekday: number; start: string; end: string }[];
  leaves: { date: string; reason: string }[];
}

export interface CategoryCfg {
  key: string;
  label: string;
  defaultDuration: number;
  minIntervalDays: number;
  hrFactor: number;
  family: 'required' | 'recommended' | 'optional';
  checkinItems: string[];
  sessionFields: string[];
  tips: string[];
}

export interface Meta {
  categories: Record<string, CategoryCfg>;
  eventTypes: Record<string, { label: string; roles: string[] }>;
  roles: Record<string, string>;
  equipmentTypes: string[];
}

export interface Bootstrap {
  patients: Patient[];
  appointments: Appointment[];
  events: RehabEvent[];
  escalations: PainEscalation[];
  equipment: Equipment[];
  plans: Plan[];
  therapists: TherapistInfo[];
  confirmations: InsuranceConfirmation[];
  billing: BillingRecord[];
  reconfirmations: PlanReconfirmation[];
  maintenanceOrders: MaintenanceOrder[];
}

/* ---------------- 医保次数不足确认单 ---------------- */
export interface InsuranceConfirmation {
  id: string;
  patientId: string;
  insuranceItem: string;
  remaining: number;
  selfPayPrice: number;
  doctorAdvice: string;
  doctorAdviceBy: string;
  doctorAdviceAt: string | null;
  status: string; // pending_advice / pending_family / confirmed / rejected / reopened
  confirmerName: string;
  confirmSessions: number | null;
  confirmAmount: number | null;
  therapistNote: string;
  therapistNoteBy: string;
  decidedAt: string | null;
  pauseReason: string;
  eventId: string | null;
  createdAt: string;
  patientName?: string;
}

/* ---------------- 收费记录 ---------------- */
export interface BillingRecord {
  id: string;
  patientId: string;
  confirmationId: string | null;
  item: string;
  sessions: number;
  amount: number;
  payType: string;
  status: string; // unpaid / paid
  confirmerName: string;
  therapistNote: string;
  note: string;
  createdAt: string;
  paidAt: string | null;
  patientName?: string;
}

/* ---------------- 器械维修工单 ---------------- */
export interface MaintenanceOrder {
  id: string;
  equipmentId: string;
  issueType: string;
  description: string;
  status: string; // open / repairing / resolved
  disinfectionStatus: string; // pending / done
  reportedBy: string;
  createdAt: string;
  updatedAt: string | null;
  resolvedAt: string | null;
  equipmentName?: string;
  equipmentType?: string;
}

/* ---------------- 计划重新确认（器械变更） ---------------- */
export interface PlanReconfirmation {
  id: string;
  patientId: string;
  planId: string | null;
  appointmentId: string;
  fromEquipmentId: string;
  toEquipmentId: string;
  reason: string;
  status: string; // pending / confirmed / cancelled
  oldGoals: string; oldRom: string;
  oldEstimatedSessions: number | null; oldPatientReminder: string;
  newGoals: string; newRom: string;
  newEstimatedSessions: number | null; newPatientReminder: string;
  confirmedBy: string;
  confirmedAt: string | null;
  createdAt: string;
  patientName?: string;
  fromEquipmentName?: string;
  toEquipmentName?: string;
  apptDate?: string;
  apptStart?: string;
}

/* ---------------- 器械影响分析 ---------------- */
export interface EquipmentImpact {
  equipment: Equipment;
  affected: Appointment[];
  alternatives: (Equipment & { sameEffect: boolean })[];
  order: MaintenanceOrder | null;
}

export interface Slot { date: string; start: string; end: string }

export interface SlotResult {
  slots: Slot[];
  warnings: string[];
  duration: number;
  insurance?: {
    item: InsuranceItem | null;
    remaining: number;
    selfPayRemaining: number;
    confirmation: InsuranceConfirmation | null;
  } | null;
}
