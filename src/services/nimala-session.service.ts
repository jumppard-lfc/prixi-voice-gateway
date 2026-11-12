import { NimalaAppointmentType, NimalaRequestType } from '../config/nimala.config';
import { PrixiCalendarSlot } from './prixi-calendar.service';

export type NimalaStep =
  | 'department'
  | 'main_menu'
  | 'appointment_type'
  | 'slot'
  | 'name'
  | 'birth_year'
  | 'detail'
  | 'booking_confirmation';

export interface NimalaSession {
  callSid: string;
  phone: string;
  clinicId: string;
  step: NimalaStep;
  requestType?: NimalaRequestType;
  appointmentType?: NimalaAppointmentType;
  eventTypeUid?: string;
  offeredSlots?: PrixiCalendarSlot[];
  selectedSlot?: PrixiCalendarSlot;
  firstName?: string;
  lastName?: string;
  patientName?: string;
  birthYear?: string;
  detail?: string;
  bookingIdempotencyKey?: string;
  answers: Array<{ step: NimalaStep; text: string }>;
  attempts: number;
  outcome?: 'booked' | 'completed' | 'abandoned' | 'handoff';
  startedAt: string;
  endedAt?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export class NimalaSessionService {
  private readonly sessions = new Map<string, NimalaSession>();

  create(callSid: string, phone: string, clinicId: string): NimalaSession {
    const session: NimalaSession = {
      callSid,
      phone,
      clinicId,
      step: 'department',
      answers: [],
      attempts: 0,
      startedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  get(callSid: string): NimalaSession | undefined {
    const session = this.sessions.get(callSid);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(callSid);
      return undefined;
    }
    return session;
  }

  save(session: NimalaSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(session.callSid, session);
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

export const nimalaSessionService = new NimalaSessionService();
