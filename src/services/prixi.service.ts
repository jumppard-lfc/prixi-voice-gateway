import axios, { AxiosInstance } from 'axios';
import { ClinicConfig, PrixiEvent } from '../types';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class PrixiService {
  private client: AxiosInstance;
  private processedEventKeys = new Map<string, number>();
  private inFlightEventKeys = new Set<string>();

  constructor() {
    this.client = axios.create({
      baseURL: process.env.PRIXI_API_URL || 'https://api.prixi.sk',
      timeout: 5000, // 5 seconds timeout protection
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PRIXI_API_KEY}`,
      },
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
        voiceBotEnabled: false,
        timezone: 'Europe/Bratislava',
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

    this.inFlightEventKeys.add(resolvedIdempotencyKey);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.client.post('/voice/call-completed', event, {
          headers: {
            'Idempotency-Key': resolvedIdempotencyKey,
          },
        });

        this.processedEventKeys.set(resolvedIdempotencyKey, Date.now() + IDEMPOTENCY_TTL_MS);
        return; // Success
      } catch (error: any) {
        const is5xxError = error.response && error.response.status >= 500 && error.response.status < 600;
        
        if (is5xxError && attempt < retries) {
          console.warn(`Attempt ${attempt} failed to send event ${event.event} to Prixi API. Retrying...`);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        } else {
          console.error(`Failed to send event ${event.event} after ${attempt} attempts:`, error);
          throw error;
        }
      }
    }

    this.inFlightEventKeys.delete(resolvedIdempotencyKey);
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
