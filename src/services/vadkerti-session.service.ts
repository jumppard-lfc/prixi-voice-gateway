import { VadkertiLanguage, VadkertiRequestType } from '../config/vadkerti.config';

export type VadkertiStep =
  | 'language'
  | 'intent'
  | 'current_clinic'
  | 'prior_neurologist'
  | 'detail'
  | 'appointment_action'
  | 'appointment_datetime'
  | 'name'
  | 'birth_year';

export interface VadkertiSession {
  callSid: string;
  phone: string;
  step: VadkertiStep;
  language?: VadkertiLanguage;
  requestType?: VadkertiRequestType;
  currentClinicPatient?: boolean;
  prescriptionEligible?: boolean;
  detail?: string;
  appointmentAction?: 'change' | 'cancel';
  originalAppointment?: string;
  patientName?: string;
  birthYear?: string;
  answers: Array<{ step: VadkertiStep; text: string }>;
  attempts: number;
  clinicId?: string;
  outcome?: 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class VadkertiSessionService {
  private sessions = new Map<string, VadkertiSession>();

  create(callSid: string, phone: string): VadkertiSession {
    const session: VadkertiSession = {
      callSid,
      phone,
      step: 'language',
      answers: [],
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): VadkertiSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: VadkertiSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const vadkertiSessionService = new VadkertiSessionService();
