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

export interface PrixiPatientBooking {
  id: string | number;
  clinicId: number;
  calendarId: number;
  calendarName?: string;
  eventTypeUid: string;
  serviceName?: string;
  startAt: string;
  endAt?: string;
  durationMinutes?: number;
  status?: string;
}

export type PrixiPatientVerificationResult =
  | { status: 'verified'; verificationToken: string; expiresIn: number }
  | { status: 'verification_failed' | 'rate_limited' | 'uncertain' | 'failed'; httpStatus?: number; code?: string; message?: string };

export type PrixiPatientBookingsResult =
  | { status: 'ok'; bookings: PrixiPatientBooking[] }
  | { status: 'verification_failed' | 'uncertain' | 'failed'; httpStatus?: number; code?: string; message?: string };

export interface ManagePrixiBookingInput {
  bookingId: string | number;
  clinicId: number;
  verificationToken: string;
  idempotencyKey: string;
}

export interface ReschedulePrixiBookingInput extends ManagePrixiBookingInput {
  calendarId: number;
  eventTypeUid: string;
  startAt: string;
}

export type PrixiRescheduleResult =
  | { status: 'rescheduled'; booking: PrixiPatientBooking; emailNotification?: string }
  | { status: 'slot_unavailable' | 'verification_failed' | 'not_found' | 'conflict' | 'validation_error' | 'uncertain' | 'failed'; httpStatus?: number; code?: string; message?: string };

export type PrixiCancelResult =
  | { status: 'cancelled' | 'already_cancelled' }
  | { status: 'verification_failed' | 'not_found' | 'conflict' | 'validation_error' | 'uncertain' | 'failed'; httpStatus?: number; code?: string; message?: string };

export type PrixiBookingResult =
  | { status: 'created'; bookingId: string | number; startAt: string; endAt?: string }
  | { status: 'slot_unavailable'; httpStatus?: number; code?: string }
  | { status: 'validation_error'; message?: string; httpStatus?: number; code?: string; validationFields?: string[]; validationDetails?: string[] }
  | { status: 'uncertain'; message?: string; httpStatus?: number; code?: string }
  | { status: 'failed'; message?: string; httpStatus?: number; code?: string; diagnostic?: string };

function asPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim()) as string | undefined;
}

function validationDetails(data: any): { fields?: string[]; details?: string[] } {
  if (!data?.errors || typeof data.errors !== 'object' || Array.isArray(data.errors)) return {};
  const fields = Object.keys(data.errors).sort();
  const details = fields.flatMap(field => {
    const messages = Array.isArray(data.errors[field]) ? data.errors[field] : [data.errors[field]];
    return messages
      .filter((message: unknown): message is string => typeof message === 'string')
      .map((message: string) => `${field}: ${message.slice(0, 300)}`);
  });
  return {
    ...(fields.length ? { fields } : {}),
    ...(details.length ? { details } : {}),
  };
}

function mapPatientBooking(value: any): PrixiPatientBooking | undefined {
  const id = value?.id ?? value?.bookingId ?? value?.booking_id;
  const clinicId = asPositiveInteger(value?.clinicId ?? value?.clinic_id);
  const calendarId = asPositiveInteger(value?.calendarId ?? value?.calendar_id);
  const eventTypeUid = firstString(value?.eventTypeUid, value?.event_type_uid);
  const startAt = firstString(value?.startAt, value?.start_at);
  if ((typeof id !== 'string' && typeof id !== 'number') || !clinicId || !calendarId || !eventTypeUid || !startAt || Number.isNaN(Date.parse(startAt))) {
    return undefined;
  }
  return {
    id,
    clinicId,
    calendarId,
    calendarName: firstString(value?.calendarName, value?.calendar_name),
    eventTypeUid,
    serviceName: firstString(value?.serviceName, value?.service_name, value?.eventTypeName, value?.event_type_name),
    startAt,
    endAt: firstString(value?.endAt, value?.end_at),
    durationMinutes: asPositiveInteger(value?.durationMinutes ?? value?.duration_minutes),
    status: firstString(value?.status),
  };
}

function apiError(error: unknown): { httpStatus?: number; code?: string; message?: string; hasResponse: boolean } {
  const axiosError = error as AxiosError<any>;
  return {
    httpStatus: axiosError.response?.status,
    code: firstString(axiosError.response?.data?.code, axiosError.response?.data?.error?.code),
    message: firstString(
      axiosError.response?.data?.message,
      axiosError.response?.data?.error?.message,
      axiosError.message
    ),
    hasResponse: Boolean(axiosError.response),
  };
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

  async verifyPatient(input: { clinicId: number; phone: string }): Promise<PrixiPatientVerificationResult> {
    try {
      const response = await this.client.post('/api/calendar/patients/verify', input);
      const verificationToken = firstString(response.data?.verificationToken, response.data?.verification_token);
      if (response.data?.success === true && verificationToken) {
        return {
          status: 'verified',
          verificationToken,
          expiresIn: asPositiveInteger(response.data?.expiresIn ?? response.data?.expires_in) || 600,
        };
      }
      return { status: 'failed', httpStatus: response.status, message: 'PriXi Calendar API returned an invalid verification response' };
    } catch (error) {
      const details = apiError(error);
      const { hasResponse, ...publicDetails } = details;
      if (details.httpStatus === 403) return { status: 'verification_failed', ...publicDetails };
      if (details.httpStatus === 429) return { status: 'rate_limited', ...publicDetails };
      if (!hasResponse || (details.httpStatus !== undefined && details.httpStatus >= 500)) return { status: 'uncertain', ...publicDetails };
      return { status: 'failed', ...publicDetails };
    }
  }

  async listPatientBookings(clinicId: number, verificationToken: string): Promise<PrixiPatientBookingsResult> {
    try {
      const response = await this.client.get('/api/calendar/bookings', {
        params: { clinicId },
        headers: { 'X-Patient-Verification-Token': verificationToken },
      });
      const values = Array.isArray(response.data?.bookings) ? response.data.bookings : [];
      return { status: 'ok', bookings: values.flatMap((value: any) => mapPatientBooking(value) || []) };
    } catch (error) {
      const details = apiError(error);
      const { hasResponse, ...publicDetails } = details;
      if (details.httpStatus === 403) return { status: 'verification_failed', ...publicDetails };
      if (!hasResponse || (details.httpStatus !== undefined && details.httpStatus >= 500)) return { status: 'uncertain', ...publicDetails };
      return { status: 'failed', ...publicDetails };
    }
  }

  async rescheduleBooking(input: ReschedulePrixiBookingInput): Promise<PrixiRescheduleResult> {
    const { bookingId, verificationToken, idempotencyKey, ...payload } = input;
    try {
      const response = await this.client.patch(`/api/calendar/bookings/${encodeURIComponent(String(bookingId))}/reschedule`, payload, {
        headers: {
          'X-Patient-Verification-Token': verificationToken,
          'Idempotency-Key': idempotencyKey,
        },
      });
      const booking = mapPatientBooking(response.data?.booking || response.data?.data?.booking || response.data?.data);
      if (response.data?.success === true && booking) {
        return {
          status: 'rescheduled',
          booking,
          emailNotification: firstString(response.data?.notification?.email),
        };
      }
      return { status: 'failed', httpStatus: response.status, message: 'PriXi Calendar API returned an invalid reschedule response' };
    } catch (error) {
      const details = apiError(error);
      const { hasResponse, ...publicDetails } = details;
      if (details.httpStatus === 403) return { status: 'verification_failed', ...publicDetails };
      if (details.httpStatus === 404) return { status: 'not_found', ...publicDetails };
      if (details.httpStatus === 409 && details.code === 'SLOT_UNAVAILABLE') return { status: 'slot_unavailable', ...publicDetails };
      if (details.httpStatus === 409) return { status: 'conflict', ...publicDetails };
      if (details.httpStatus === 422) return { status: 'validation_error', ...publicDetails };
      if (!hasResponse || (details.httpStatus !== undefined && details.httpStatus >= 500)) return { status: 'uncertain', ...publicDetails };
      return { status: 'failed', ...publicDetails };
    }
  }

  async cancelBooking(input: ManagePrixiBookingInput): Promise<PrixiCancelResult> {
    const { bookingId, verificationToken, idempotencyKey, clinicId } = input;
    try {
      const response = await this.client.post(`/api/calendar/bookings/${encodeURIComponent(String(bookingId))}/cancel`, { clinicId }, {
        headers: {
          'X-Patient-Verification-Token': verificationToken,
          'Idempotency-Key': idempotencyKey,
        },
      });
      const code = firstString(response.data?.code);
      if (response.data?.success === true && code === 'CANCELLED') return { status: 'cancelled' };
      if (response.data?.success === true && code === 'ALREADY_CANCELLED') return { status: 'already_cancelled' };
      return { status: 'failed', httpStatus: response.status, message: 'PriXi Calendar API returned an invalid cancellation response' };
    } catch (error) {
      const details = apiError(error);
      const { hasResponse, ...publicDetails } = details;
      if (details.httpStatus === 403) return { status: 'verification_failed', ...publicDetails };
      if (details.httpStatus === 404) return { status: 'not_found', ...publicDetails };
      if (details.httpStatus === 409) return { status: 'conflict', ...publicDetails };
      if (details.httpStatus === 422) return { status: 'validation_error', ...publicDetails };
      if (!hasResponse || (details.httpStatus !== undefined && details.httpStatus >= 500)) return { status: 'uncertain', ...publicDetails };
      return { status: 'failed', ...publicDetails };
    }
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
      const booking = response.data?.booking
        || response.data?.data?.booking
        || response.data?.data
        || (response.status === 201 ? response.data : undefined);
      const bookingId = booking?.id ?? response.data?.bookingId ?? response.data?.booking_id;
      const responseIndicatesCreated = response.data?.success === true || response.status === 201;
      if (responseIndicatesCreated && bookingId !== undefined && bookingId !== null) {
        return {
          status: 'created',
          bookingId,
          startAt: firstString(booking.startAt, booking.start_at) || input.startAt,
          endAt: firstString(booking.endAt, booking.end_at),
        };
      }
      return {
        status: 'failed',
        message: 'PriXi Calendar API returned an invalid success response',
        httpStatus: response.status,
        diagnostic: `response_keys:${Object.keys(response.data || {}).sort().join(',') || 'none'}`,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      const status = axiosError.response?.status;
      const code = firstString(axiosError.response?.data?.code, axiosError.response?.data?.error?.code);
      const message = firstString(
        axiosError.response?.data?.message,
        axiosError.response?.data?.error?.message,
        axiosError.message
      );
      if (status === 409 && code === 'SLOT_UNAVAILABLE') return { status: 'slot_unavailable', httpStatus: status, code };
      if (status === 422) {
        const validation = validationDetails(axiosError.response?.data);
        return {
          status: 'validation_error',
          message,
          httpStatus: status,
          code,
          validationFields: validation.fields,
          validationDetails: validation.details,
        };
      }
      if (!axiosError.response || (status !== undefined && status >= 500)) return { status: 'uncertain', message, httpStatus: status, code };
      return { status: 'failed', message, httpStatus: status, code };
    }
  }
}

export const prixiCalendarService = new PrixiCalendarServiceClient();

