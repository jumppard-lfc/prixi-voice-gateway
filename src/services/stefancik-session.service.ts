import { ClinicConfig } from '../types';
import { StefancikRequestType } from '../config/stefancik.config';

export type StefancikStep = 'menu' | 'prescription_detail';

export interface StefancikSession {
  callSid: string;
  phone: string;
  routingPhoneNumber: string;
  clinicId: string;
  config: ClinicConfig;
  step: StefancikStep;
  requestType?: StefancikRequestType;
  detail?: string;
  attempts: number;
  startedAt: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class StefancikSessionService {
  private readonly sessions = new Map<string, StefancikSession>();

  create(callSid: string, phone: string, routingPhoneNumber: string, config: ClinicConfig): StefancikSession {
    const session: StefancikSession = {
      callSid,
      phone,
      routingPhoneNumber,
      clinicId: String(config.clinicId),
      config,
      step: 'menu',
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): StefancikSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: StefancikSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): boolean {
    return this.sessions.delete(callSid);
  }
}

export const stefancikSessionService = new StefancikSessionService();
