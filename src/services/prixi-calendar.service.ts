import axios, { AxiosError, AxiosInstance } from 'axios';

export interface PrixiCalendarServiceOption {
  calendarId: number;
  calendarName?: string;
  eventTypeId?: number;
  durationMinutes?: number;
}

export interface PrixiCalendarService {
  eventTypeUid: string;
  name: string;
  calendars: PrixiCalendarServiceOption[];
}

export interface PrixiCalendarSlot {
  startAt: string;
  calendarId: number;
  calendarName?: string;
  eventTypeId?: number;
  durationMinutes?: number;
}

export interface CreatePrixiBookingInput {
  clinicId: number;
  calendarId: number;
  eventTypeUid: string;
  startAt: string;
  patient: { name: string; surname: string; phone_number: string };
  metadata: { source: 'voice_bot'; externalReference: string };
  idempotencyKey: string;
}

export type PrixiBookingResult =
  | { status: 'created'; bookingId: string | number; startAt: string; endAt?: string }
  | { status: 'slot_unavailable' }
  | { status: 'validation_error'; message?: string }
  | { status: 'uncertain'; message?: string }
  | { status: 'failed'; message?: string };

function asPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim()) as string | undefined;
}

export class PrixiCalendarServiceClient {
  private readonly client: AxiosInstance;

  constructor(client?: AxiosInstance) {
    if (client) {
      this.client = client;
      return;
    }

    const baseURL = process.env.PRIXI_CALENDAR_API_URL?.trim() || process.env.PRIXI_API_URL?.trim() || 'https://api.prixi.sk';
    const token = process.env.PRIXI_CALENDAR_API_TOKEN?.trim()
      || process.env.PRIXI_API_KEY?.trim()
      || process.env.PRIXI_VOICE_GATEWAY_TOKEN?.trim();

    this.client = axios.create({
      baseURL,
      timeout: 10_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  async listServices(clinicId: number): Promise<PrixiCalendarService[]> {
    const response = await this.client.get('/api/calendar/services', { params: { clinicId } });
    const services = Array.isArray(response.data?.services) ? response.data.services : [];
    return services.flatMap((service: any) => {
      const eventTypeUid = firstString(service?.eventTypeUid, service?.uid);
      const name = firstString(service?.name, service?.label);
      if (!eventTypeUid || !name) return [];
      const calendars = (Array.isArray(service?.calendars) ? service.calendars : []).flatMap((calendar: any) => {
        const calendarId = asPositiveInteger(calendar?.calendarId ?? calendar?.id);
        if (!calendarId) return [];
        return [{
          calendarId,
          calendarName: firstString(calendar?.calendarName, calendar?.name),
          eventTypeId: asPositiveInteger(calendar?.eventTypeId),
          durationMinutes: asPositiveInteger(calendar?.durationMinutes),
        }];
      });
      return [{ eventTypeUid, name, calendars }];
    });
  }

  async getAvailableSlots(input: {
    clinicId: number;
    eventTypeUid: string;
    from: string;
    to: string;
    limit?: number;
  }): Promise<PrixiCalendarSlot[]> {
    const response = await this.client.get('/api/calendar/available-slots', { params: input });
    const groups = Array.isArray(response.data?.slots) ? response.data.slots : [];
    const slots: PrixiCalendarSlot[] = [];

    for (const group of groups) {
      const groupStartAt = firstString(group?.startAt, group?.start_at);
      const options = Array.isArray(group?.options) && group.options.length ? group.options : [group];
      for (const option of options) {
        const startAt = firstString(option?.startAt, option?.start_at, groupStartAt);
        const calendar = option?.calendar && typeof option.calendar === 'object' ? option.calendar : undefined;
        const calendarId = asPositiveInteger(option?.calendarId ?? option?.calendar_id ?? calendar?.id);
        if (!startAt || !calendarId || Number.isNaN(Date.parse(startAt))) continue;
        slots.push({
          startAt,
          calendarId,
          calendarName: firstString(option?.calendarName, option?.calendar_name, calendar?.name),
          eventTypeId: asPositiveInteger(option?.eventTypeId ?? option?.event_type_id),
          durationMinutes: asPositiveInteger(option?.durationMinutes ?? option?.duration_minutes),
        });
      }
    }

    return slots.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  }

  async createBooking(input: CreatePrixiBookingInput): Promise<PrixiBookingResult> {
    const { idempotencyKey, ...payload } = input;
    try {
      const response = await this.client.post('/api/calendar/bookings', {
        ...payload,
        sendNotification: false,
      }, {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      const booking = response.data?.booking;
      if (response.data?.success === true && booking?.id !== undefined) {
        return {
          status: 'created',
          bookingId: booking.id,
          startAt: firstString(booking.startAt, booking.start_at) || input.startAt,
          endAt: firstString(booking.endAt, booking.end_at),
        };
      }
      return { status: 'failed', message: 'PriXi Calendar API returned an invalid success response' };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      const status = axiosError.response?.status;
      const code = firstString(axiosError.response?.data?.code, axiosError.response?.data?.error?.code);
      const message = firstString(axiosError.response?.data?.message, axiosError.message);
      if (status === 409 && code === 'SLOT_UNAVAILABLE') return { status: 'slot_unavailable' };
      if (status === 422) return { status: 'validation_error', message };
      if (!axiosError.response || (status !== undefined && status >= 500)) return { status: 'uncertain', message };
      return { status: 'failed', message };
    }
  }
}

export const prixiCalendarService = new PrixiCalendarServiceClient();

