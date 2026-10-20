import { KutakovaHealthInsurer } from '../config/kutakova.config';

export type KutakovaStep = 'consent' | 'name' | 'date_of_birth' | 'health_insurer' | 'municipality' | 'confirmation';

export interface KutakovaSession {
  callSid: string;
  phone: string;
  step: KutakovaStep;
  patientName?: string;
  dateOfBirth?: string;
  healthInsurer?: KutakovaHealthInsurer;
  municipality?: string;
  consentRecordedAt?: string;
  attempts: number;
  startedAt: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_CALLS = 20;

export class KutakovaSessionService {
  private readonly sessions = new Map<string, KutakovaSession>();

  private prune(): void {
    const now = Date.now();
    for (const [callSid, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(callSid);
    }
  }

  create(callSid: string, phone: string): KutakovaSession | undefined {
    this.prune();
    const existing = this.sessions.get(callSid);
    if (existing) return existing;
    if (this.sessions.size >= MAX_CONCURRENT_CALLS) return undefined;
    const session: KutakovaSession = {
      callSid,
      phone,
      step: 'consent',
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): KutakovaSession | undefined {
    this.prune();
    return this.sessions.get(callSid);
  }

  save(session: KutakovaSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): boolean {
    return this.sessions.delete(callSid);
  }

  resetForTests(): void {
    this.sessions.clear();
  }
}

export const kutakovaSessionService = new KutakovaSessionService();
