import { ElisseaAppointmentType, ElisseaRequestType } from '../config/elissea.config';

export type ElisseaStep =
  | 'existing_patient'
  | 'name'
  | 'birth_year'
  | 'main_menu'
  | 'appointment_type'
  | 'administrative_type'
  | 'detail';

export interface ElisseaSession {
  callSid: string;
  phone: string;
  clinicId: string;
  step: ElisseaStep;
  existingPatient?: boolean;
  patientName?: string;
  birthYear?: string;
  requestType?: ElisseaRequestType;
  appointmentType?: ElisseaAppointmentType;
  detail?: string;
  answers: Array<{ step: ElisseaStep; text: string }>;
  attempts: number;
  outcome?: 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class ElisseaSessionService {
  private sessions = new Map<string, ElisseaSession>();

  create(callSid: string, phone: string, clinicId: string): ElisseaSession {
    const session: ElisseaSession = {
      callSid,
      phone,
      clinicId,
      step: 'existing_patient',
      answers: [],
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): ElisseaSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: ElisseaSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const elisseaSessionService = new ElisseaSessionService();
