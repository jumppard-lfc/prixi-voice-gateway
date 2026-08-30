export type BookingAuditEventName =
  | 'started'
  | 'service_selected'
  | 'slots_offered'
  | 'slot_selected'
  | 'identity_collected'
  | 'terms_accepted'
  | 'marketing_recorded'
  | 'booking_created'
  | 'sms_sent'
  | 'sms_failed'
  | 'completed'
  | 'failed';

export interface BookingAuditEvent {
  event: BookingAuditEventName;
  at: string;
  details?: Record<string, string | boolean | number | undefined>;
}

interface BookingAuditTrail { expiresAt: number; events: BookingAuditEvent[]; }

const AUDIT_TTL_MS = 24 * 60 * 60 * 1000;

/** Short-lived operational trace; production must replace this with PriXi's access-controlled audit store. */
export class BookingAuditService {
  private trails = new Map<string, BookingAuditTrail>();

  record(callSid: string, event: BookingAuditEventName, details?: BookingAuditEvent['details']): BookingAuditEvent {
    this.prune();
    const item: BookingAuditEvent = { event, at: new Date().toISOString(), details };
    const trail = this.trails.get(callSid) || { expiresAt: Date.now() + AUDIT_TTL_MS, events: [] };
    trail.expiresAt = Date.now() + AUDIT_TTL_MS;
    trail.events.push(item);
    this.trails.set(callSid, trail);
    return item;
  }

  get(callSid: string): BookingAuditEvent[] | undefined {
    this.prune();
    return this.trails.get(callSid)?.events;
  }

  private prune(): void {
    const now = Date.now();
    for (const [callSid, trail] of this.trails) if (trail.expiresAt <= now) this.trails.delete(callSid);
  }
}

export const bookingAuditService = new BookingAuditService();
