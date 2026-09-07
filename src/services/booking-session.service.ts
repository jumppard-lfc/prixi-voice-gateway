import { BookingServiceCode, DatePreference, OfferedSlot } from '../types';

export type BookingStep =
  | 'service'
  | 'date_preference'
  | 'slot'
  | 'name'
  | 'terms'
  | 'verification'
  | 'confirmation';

export type BookingVerificationTarget = 'service' | 'date_preference' | 'slot';

export interface BookingSession {
  callSid: string;
  phone: string;
  publicBaseUrl?: string;
  step: BookingStep;
  service?: BookingServiceCode;
  preference?: DatePreference;
  offeredSlots?: OfferedSlot[];
  selectedSlot?: OfferedSlot;
  firstName?: string;
  lastName?: string;
  acceptedTerms?: boolean;
  verificationTarget?: BookingVerificationTarget;
  forceDtmf?: boolean;
  attempts: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 20 * 60 * 1000;

export class BookingSessionService {
  private sessions = new Map<string, BookingSession>();

  create(callSid: string, phone: string, publicBaseUrl?: string): BookingSession {
    const session: BookingSession = { callSid, phone, publicBaseUrl, step: 'service', attempts: 0, expiresAt: Date.now() + SESSION_TTL_MS };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): BookingSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: BookingSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const bookingSessionService = new BookingSessionService();
