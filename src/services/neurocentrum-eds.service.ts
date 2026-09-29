import axios, { AxiosError, AxiosInstance } from 'axios';
import { NeurocentrumRequestType } from '../config/neurocentrum.config';

export type NeurocentrumAvailabilityStatus = 'open' | 'vacation' | 'outside_hours' | 'disabled';

export interface NeurocentrumMessages {
  greeting: string;
  existingPatientQuestion: string;
  newPatient: string;
  vacation: string;
  afterHours: string;
  busy: string;
  technical: string;
  urgent: string;
  completion: string;
}

export interface NeurocentrumRuntimeConfig {
  clinicId: string;
  assistantType?: string;
  enabled: boolean;
  timezone: string;
  availability: {
    status: NeurocentrumAvailabilityStatus;
    message?: string;
  };
  maxConcurrentCalls: number;
  messages: NeurocentrumMessages;
}

export interface NeurocentrumPatientRequestEvent {
  event: 'patient_request.created';
  version: 1;
  clinicId: string;
  callSid: string;
  occurredAt: string;
  call: {
    phone: string;
    durationSeconds: number;
  };
  patient: {
    existingPatient: true;
    firstName: string;
    lastName: string;
    birthDate: string;
  };
  request: {
    type: NeurocentrumRequestType;
    detail: string;
  };
}

interface ConfigCacheEntry {
  config: NeurocentrumRuntimeConfig;
  fetchedAt: number;
}

const DEFAULT_CONFIG_CACHE_TTL_MS = 30_000;
const DEFAULT_LAST_KNOWN_GOOD_TTL_MS = 5 * 60_000;
const DEFAULT_API_TIMEOUT_MS = 2_500;
const DEFAULT_EVENT_ATTEMPTS = 3;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`EDS voice configuration is missing ${field}`);
  }
  return value.trim();
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find(candidate => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeConfig(data: any): NeurocentrumRuntimeConfig {
  const messages = data?.messages || {};
  const status = data?.availability?.status as NeurocentrumAvailabilityStatus | undefined;
  const allowedStatuses = new Set<NeurocentrumAvailabilityStatus>(['open', 'vacation', 'outside_hours', 'disabled']);
  const maxConcurrentCalls = Number(data?.maxConcurrentCalls);

  if (!allowedStatuses.has(status || 'open')) {
    throw new Error(`EDS returned an unsupported availability status: ${String(status)}`);
  }
  if (!Number.isInteger(maxConcurrentCalls) || maxConcurrentCalls < 1 || maxConcurrentCalls > 100) {
    throw new Error('EDS voice configuration contains an invalid maxConcurrentCalls value');
  }

  return {
    clinicId: String(data?.clinicId ?? '').trim() || (() => { throw new Error('EDS voice configuration is missing clinicId'); })(),
    assistantType: firstString(data?.assistantType),
    enabled: data?.enabled ?? data?.voiceBotEnabled ?? false,
    timezone: requiredString(data?.timezone, 'timezone'),
    availability: {
      status: status || (data?.enabled === false || data?.voiceBotEnabled === false ? 'disabled' : 'open'),
      message: firstString(data?.availability?.message),
    },
    maxConcurrentCalls,
    messages: {
      greeting: requiredString(messages.greeting, 'messages.greeting'),
      existingPatientQuestion: requiredString(messages.existingPatientQuestion, 'messages.existingPatientQuestion'),
      newPatient: requiredString(messages.newPatient, 'messages.newPatient'),
      vacation: requiredString(messages.vacation, 'messages.vacation'),
      afterHours: requiredString(firstString(messages.afterHours, messages.outsideHours), 'messages.afterHours'),
      busy: requiredString(messages.busy, 'messages.busy'),
      technical: requiredString(firstString(messages.technical, messages.technicalError), 'messages.technical'),
      urgent: requiredString(messages.urgent, 'messages.urgent'),
      completion: requiredString(firstString(messages.completion, messages.success), 'messages.completion'),
    },
  };
}

function isDuplicateResponse(error: AxiosError<any>): boolean {
  const status = error.response?.status;
  if (status !== 409 && status !== 422) return false;
  const data = error.response?.data;
  const marker = `${data?.status || ''} ${data?.message || ''}`.toLocaleLowerCase('sk-SK');
  return marker.includes('duplicate') || marker.includes('duplicit') || marker.includes('vytvoren');
}

function isRetryable(error: AxiosError): boolean {
  const status = error.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}

export class NeurocentrumEdsService {
  private readonly client: AxiosInstance;
  private readonly cache = new Map<string, ConfigCacheEntry>();
  private readonly configCacheTtlMs: number;
  private readonly lastKnownGoodTtlMs: number;
  private readonly eventAttempts: number;

  constructor(client?: AxiosInstance) {
    const token = process.env.EDS_VOICE_API_TOKEN?.trim() || process.env.PRIXI_API_KEY?.trim();
    this.client = client || axios.create({
      baseURL: process.env.EDS_API_URL?.trim() || process.env.PRIXI_API_URL?.trim() || 'https://api.prixi.sk',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    this.configCacheTtlMs = positiveInteger(process.env.EDS_VOICE_CONFIG_CACHE_TTL_MS, DEFAULT_CONFIG_CACHE_TTL_MS);
    this.lastKnownGoodTtlMs = positiveInteger(process.env.EDS_VOICE_CONFIG_LKG_TTL_MS, DEFAULT_LAST_KNOWN_GOOD_TTL_MS);
    this.eventAttempts = positiveInteger(process.env.EDS_VOICE_EVENT_ATTEMPTS, DEFAULT_EVENT_ATTEMPTS);
  }

  async getConfig(phoneNumber: string): Promise<NeurocentrumRuntimeConfig> {
    const key = phoneNumber.trim();
    if (!key) throw new Error('Cannot load EDS voice configuration without a phone number');
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt <= this.configCacheTtlMs) return cached.config;

    try {
      const response = await this.client.get('/api/voice/config', {
        params: { phoneNumber: key },
        timeout: positiveInteger(process.env.EDS_VOICE_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS),
      });
      const config = normalizeConfig(response.data);
      if (config.clinicId.toLowerCase() === 'orphan') throw new Error(`EDS has no clinic configuration for ${key}`);
      this.cache.set(key, { config, fetchedAt: now });
      return config;
    } catch (error) {
      if (cached && now - cached.fetchedAt <= this.lastKnownGoodTtlMs) return cached.config;
      throw new Error(`Failed to load Neurocentrum configuration from EDS: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async resolveByInboundPhoneNumber(phoneNumber: string): Promise<NeurocentrumRuntimeConfig | undefined> {
    const key = phoneNumber.trim();
    if (!key) return undefined;

    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt <= this.configCacheTtlMs) {
      return cached.config.assistantType === 'neurocentrum' ? cached.config : undefined;
    }

    const response = await this.client.get('/api/voice/config', {
      params: { phoneNumber: key },
      timeout: positiveInteger(process.env.EDS_VOICE_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS),
    });

    if (String(response.data?.clinicId ?? '').trim().toLowerCase() === 'orphan') return undefined;

    const config = normalizeConfig(response.data);
    if (config.assistantType !== 'neurocentrum') return undefined;

    this.cache.set(key, { config, fetchedAt: now });
    return config;
  }

  async sendPatientRequest(event: NeurocentrumPatientRequestEvent): Promise<'created' | 'duplicate'> {
    const timeout = positiveInteger(process.env.EDS_VOICE_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.eventAttempts; attempt += 1) {
      try {
        const response = await this.client.post('/api/voice/event', event, {
          timeout,
          headers: { 'Idempotency-Key': event.callSid },
        });
        const status = String(response.data?.status || '').toLowerCase();
        if (status === 'duplicate') return 'duplicate';
        if (status === 'success' || status === 'created' || status === 'accepted') return 'created';
        throw new Error(`EDS did not confirm durable patient-request storage (status: ${status || 'missing'})`);
      } catch (error) {
        if (axios.isAxiosError(error) && isDuplicateResponse(error)) return 'duplicate';
        lastError = error;
        if (!axios.isAxiosError(error) || !isRetryable(error) || attempt === this.eventAttempts) break;
        await new Promise(resolve => setTimeout(resolve, attempt * 250));
      }
    }

    throw new Error(`Failed to store Neurocentrum patient request in EDS: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  resetForTests(): void {
    this.cache.clear();
  }
}

export const neurocentrumEdsService = new NeurocentrumEdsService();
