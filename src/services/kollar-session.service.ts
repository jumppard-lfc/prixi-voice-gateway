import { KollarRequestType } from '../config/kollar.config';

export type KollarStep = 'main_menu' | 'detail' | 'recording';

export interface KollarSession {
  callSid: string;
  phone: string;
  clinicId: string;
  step: KollarStep;
  requestType?: KollarRequestType;
  detail?: string;
  recordingUrl?: string;
  recordingDurationSeconds?: number;
  answers: Array<{ step: KollarStep; text: string }>;
  attempts: number;
  outcome?: 'completed' | 'abandoned';
  startedAt: string;
  endedAt?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class KollarSessionService {
  private sessions = new Map<string, KollarSession>();

  create(callSid: string, phone: string, clinicId: string): KollarSession {
    const session: KollarSession = {
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

  get(callSid: string): KollarSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: KollarSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const kollarSessionService = new KollarSessionService();
