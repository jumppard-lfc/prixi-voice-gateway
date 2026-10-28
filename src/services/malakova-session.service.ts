import { MalakovaAppointmentType, MalakovaRequestType } from '../config/malakova.config';

export type MalakovaStep = 'main_menu' | 'appointment_type' | 'name' | 'prescription_detail';

export interface MalakovaSession {
  callSid: string;
  phone: string;
  clinicId: string;
  step: MalakovaStep;
  requestType?: MalakovaRequestType;
  appointmentType?: MalakovaAppointmentType;
  patientName?: string;
  detail?: string;
  answers: Array<{ step: MalakovaStep; text: string }>;
  attempts: number;
  outcome?: 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class MalakovaSessionService {
  private readonly sessions = new Map<string, MalakovaSession>();

  create(callSid: string, phone: string, clinicId: string): MalakovaSession {
    const session: MalakovaSession = {
      callSid,
      phone,
      clinicId,
      step: 'main_menu',
      answers: [],
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): MalakovaSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: MalakovaSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const malakovaSessionService = new MalakovaSessionService();
