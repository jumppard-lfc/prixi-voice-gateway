import { NeurocentrumRequestType } from '../config/neurocentrum.config';
import { NeurocentrumRuntimeConfig } from './neurocentrum-eds.service';

export type NeurocentrumStep = 'existing_patient' | 'name' | 'date_of_birth' | 'request_type' | 'detail' | 'confirmation';

export interface NeurocentrumSession {
  callSid: string;
  phone: string;
  config: NeurocentrumRuntimeConfig;
  step: NeurocentrumStep;
  patientName?: string;
  dateOfBirth?: string;
  requestType?: NeurocentrumRequestType;
  detail?: string;
  attempts: number;
  startedAt: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class NeurocentrumSessionService {
  private sessions = new Map<string, NeurocentrumSession>();

  private prune(): void {
    const now = Date.now();
    for (const [callSid, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(callSid);
    }
  }

  create(callSid: string, phone: string, config: NeurocentrumRuntimeConfig): NeurocentrumSession | undefined {
    this.prune();
    const existing = this.sessions.get(callSid);
    if (existing) return existing;
    if (this.sessions.size >= config.maxConcurrentCalls) return undefined;
    const session: NeurocentrumSession = {
      callSid,
      phone,
      config,
      step: 'existing_patient',
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): NeurocentrumSession | undefined {
    this.prune();
    return this.sessions.get(callSid);
  }

  save(session: NeurocentrumSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): boolean {
    return this.sessions.delete(callSid);
  }

  activeCount(): number {
    this.prune();
    return this.sessions.size;
  }

  resetForTests(): void {
    this.sessions.clear();
  }
}

export const neurocentrumSessionService = new NeurocentrumSessionService();
