import { LenerovaRequestType } from '../config/lenerova.config';
import { ClinicConfig } from '../types';

export type LenerovaStep = 'main_menu' | 'name' | 'birth_year' | 'detail' | 'information_follow_up';

export interface LenerovaSession {
  callSid: string;
  phone: string;
  clinicId: string;
  config: ClinicConfig;
  step: LenerovaStep;
  requestType?: LenerovaRequestType;
  patientName?: string;
  birthYear?: string;
  detail?: string;
  answers: Array<{ step: LenerovaStep; text: string }>;
  answeredInformationQuestions: number;
  attempts: number;
  outcome?: 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class LenerovaSessionService {
  private readonly sessions = new Map<string, LenerovaSession>();

  create(callSid: string, phone: string, config: ClinicConfig): LenerovaSession {
    const session: LenerovaSession = {
      callSid,
      phone,
      clinicId: String(config.clinicId),
      config,
      step: 'main_menu',
      answers: [],
      answeredInformationQuestions: 0,
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): LenerovaSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: LenerovaSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): boolean {
    return this.sessions.delete(callSid);
  }
}

export const lenerovaSessionService = new LenerovaSessionService();
