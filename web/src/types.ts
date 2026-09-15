/* ---------------- 与后端 API 对应的类型 ---------------- */

export type Role = 'frontdesk' | 'therapist' | 'patient' | 'family' | 'maintenance';

export interface User {
  id: string;
  username: string;
  role: Role;
  name: string;
  patientId: string | null;
}

export interface InsuranceItem { name: string; total: number; used: number }

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
  updatedAt?: string; by?: string;
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
  equipment: Equipment[];
  plans: Plan[];
  therapists: TherapistInfo[];
}

export interface Slot { date: string; start: string; end: string }

export interface SlotResult { slots: Slot[]; warnings: string[]; duration: number }
