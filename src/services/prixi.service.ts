import axios, { AxiosInstance } from 'axios';
import { ClinicConfig, PrixiEvent } from '../types';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function generateCurlCommand(method: string, url: string, headers: Record<string, any>, data: any): string {
  let curl = `curl -X ${method.toUpperCase()} "${url}"`;
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      // Mask token if it is sensitive
      const cleanValue = key.toLowerCase() === 'authorization' && typeof value === 'string' && value.length > 20
        ? `${value.substring(0, 15)}...`
        : value;
      curl += ` -H "${key}: ${cleanValue}"`;
    }
  }
  if (data) {
    curl += ` -d '${JSON.stringify(data)}'`;
  }
  return curl;
}

export class PrixiService {
  private client: AxiosInstance;
  private processedEventKeys = new Map<string, number>();
  private inFlightEventKeys = new Set<string>();
  private readonly mockMode: boolean;

  constructor() {
    const hasApiUrl = Boolean(process.env.PRIXI_API_URL);
    const explicitMockMode = process.env.PRIXI_MOCK_MODE === 'true';

    this.mockMode = explicitMockMode || !hasApiUrl;

    if (this.mockMode) {
      console.warn('Prixi API mock mode enabled: remote config/events are bypassed.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (process.env.PRIXI_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.PRIXI_API_KEY}`;
    }

    this.client = axios.create({
      baseURL: process.env.PRIXI_API_URL || 'https://api.prixi.sk',
      timeout: 10000,
      headers,
    });
  }

  private getEventIdempotencyKey(event: PrixiEvent): string {
    if (event.event === 'call_forwarded') {
      return `${event.event}:${event.callSid}`;
    }

    return `${event.event}:${event.providerCallId}`;
  }

  private pruneEventKeys(): void {
    const now = Date.now();

    for (const [key, expiresAt] of this.processedEventKeys.entries()) {
      if (expiresAt <= now) {
        this.processedEventKeys.delete(key);
      }
    }
  }

  /**
   * Fetches the voice bot configuration for a given phone number.
   * Provides a fallback configuration if the API call fails or times out.
   */
  async getConfig(phoneNumber: string): Promise<ClinicConfig> {
    if (this.mockMode) {
      return {
        clinicId: process.env.PRIXI_FALLBACK_CLINIC_ID || 'local-dev',
        voiceBotEnabled: true,
        timezone: process.env.PRIXI_FALLBACK_TIMEZONE || 'Europe/Bratislava',
        allowForwardDuringOfficeHours: false,
        professionalId: Number(process.env.PRIXI_DEFAULT_PROFESSIONAL_ID) || 1,
        healthcareProviderId: Number(process.env.PRIXI_DEFAULT_HEALTHCARE_PROVIDER_ID) || 1,
      };
    }

    try {
      const response = await this.client.get<ClinicConfig>('/voice/config', {
        params: { phoneNumber },
        timeout: 2000,
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch config for ${phoneNumber}:`, error);
      // Fallback configuration to prevent total failure
      return {
        clinicId: 'fallback',
        voiceBotEnabled: true,
        timezone: 'Europe/Bratislava',
        professionalId: 1,
        healthcareProviderId: 1,
      };
    }
  }

  /**
   * Sends an event (call_forwarded or voicemail_recorded) to the Prixi API.
   * Implements basic retry logic for 5xx errors.
   */
  async sendEvent(event: PrixiEvent, retries = 3, idempotencyKey?: string): Promise<void> {
    const resolvedIdempotencyKey = idempotencyKey || this.getEventIdempotencyKey(event);

    this.pruneEventKeys();

    if (this.processedEventKeys.has(resolvedIdempotencyKey) || this.inFlightEventKeys.has(resolvedIdempotencyKey)) {
      return;
    }

    // 1. Process payload converting voice events to API requests
    let apiEndpoint = '/voice/call-completed';
    let apiPayload: any = event;

    if (event.event === 'voicemail_recorded') {
      apiEndpoint = '/api/requests/store';
      const config = await this.getConfig(event.phone);

      apiPayload = {
        professional_id: config.professionalId || 1,
        patient: {
          name: 'Pacient',
          surname: 'Zmeškaný Hovor',
          email: null,
          phone_number: event.phone,
        },
        requests: [
          {
            healthcare_provider_id: config.healthcareProviderId || 1,
            request_title: 'Hlasová správa',
            request_priority: 'medium',
            request_type: 'phone_call',
            request_description: `Meno: ${event.nameTranscript}\nRok narodenia: ${event.birthYearTranscript}\nProblém: ${event.problemTranscript}\n\nDĺžka hovoru: ${event.durationSeconds} sekúnd\n\n[Hlasové záznamy: </br>Meno: <a href="${event.nameUrl}">${event.nameUrl}</a></br>Rok narodenia: <a href="${event.birthYearUrl}">${event.birthYearUrl}</a></br>Problém: <a href="${event.problemUrl}">${event.problemUrl}</a>]`,
            data: {
              patient_name: event.nameTranscript,
              patient_birth_year: event.birthYearTranscript,
              phone_duration_seconds: event.durationSeconds
            }
          }
        ],
        online: false,
        appointment_date: null,
        returnURL: 'https://prixi.sk',
      };
    }

    const fullUrl = `${this.client.defaults.baseURL}${apiEndpoint}`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${process.env.PRIXI_API_KEY}`,
      'Idempotency-Key': resolvedIdempotencyKey
    };

    if (this.mockMode) {
      const curlCommand = generateCurlCommand('POST', fullUrl, requestHeaders, apiPayload);
      console.info(`[Prixi Mock Mode] Simulated API Request to ${apiEndpoint}\nEquivalent cURL:\n${curlCommand}`);
      console.info(`[Prixi Mock Mode] Simulated API Response (200 OK):\n{ "success": true }`);

      this.processedEventKeys.set(resolvedIdempotencyKey, Date.now() + IDEMPOTENCY_TTL_MS);
      return;
    }

    this.inFlightEventKeys.add(resolvedIdempotencyKey);

    try {
      const curlCommand = generateCurlCommand('POST', fullUrl, requestHeaders, apiPayload);
      console.info(`[Outbound API Request] Calling ${apiEndpoint}\nEquivalent cURL:\n${curlCommand}`);

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const response = await this.client.post(apiEndpoint, apiPayload, {
            headers: {
              'Idempotency-Key': resolvedIdempotencyKey,
            },
          });

          console.info(`[Outbound API Response] ${apiEndpoint} returned status ${response.status}\nBody:`, JSON.stringify(response.data, null, 2));

          this.processedEventKeys.set(resolvedIdempotencyKey, Date.now() + IDEMPOTENCY_TTL_MS);
          return; // Success
        } catch (error: any) {
          const status = error.response?.status;
          const data = error.response?.data;

          // If the request was already created, treat it as a successful idempotency block
          if (status === 422 && data && typeof data.message === 'string' && (data.message.includes('vytvorená') || data.message.includes('vytvorena'))) {
            console.info(`[Outbound API Response] ${apiEndpoint} returned status 422 (Duplicate request). Treating as success.`);
            this.processedEventKeys.set(resolvedIdempotencyKey, Date.now() + IDEMPOTENCY_TTL_MS);
            return;
          }

          const is5xxError = status >= 500 && status < 600;

          if (is5xxError && attempt < retries) {
            console.warn(`Attempt ${attempt} failed to send event ${event.event} to Prixi API. Retrying...`);
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          } else {
            console.error(`Failed to send event ${event.event} after ${attempt} attempts:`, error.response ? { status: error.response.status, data: error.response.data } : error.message);
            throw error;
          }
        }
      }
    } finally {
      this.inFlightEventKeys.delete(resolvedIdempotencyKey);
    }
  }

  releaseEvent(event: PrixiEvent, idempotencyKey?: string): void {
    const resolvedIdempotencyKey = idempotencyKey || this.getEventIdempotencyKey(event);
    this.inFlightEventKeys.delete(resolvedIdempotencyKey);
  }

  completeEvent(event: PrixiEvent, idempotencyKey?: string): void {
    const resolvedIdempotencyKey = idempotencyKey || this.getEventIdempotencyKey(event);
    this.inFlightEventKeys.delete(resolvedIdempotencyKey);
    this.processedEventKeys.set(resolvedIdempotencyKey, Date.now() + IDEMPOTENCY_TTL_MS);
  }

  isEventProcessed(event: PrixiEvent, idempotencyKey?: string): boolean {
    const resolvedIdempotencyKey = idempotencyKey || this.getEventIdempotencyKey(event);
    this.pruneEventKeys();
    return this.processedEventKeys.has(resolvedIdempotencyKey);
  }
}

export const prixiService = new PrixiService();
