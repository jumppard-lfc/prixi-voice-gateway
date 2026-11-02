import axios from 'axios';

type HttpClient = {
  post<T>(url: string, data: unknown, config?: unknown): Promise<{ data: T; status?: number }>;
};

type PrixiVoiceSmsResponse = {
  success?: boolean;
  sms_log_id?: number;
  status?: string;
  message?: string;
};

export interface PrixiVoiceSmsResult {
  smsLogId?: number;
  status: string;
}

export interface SendPrixiVoiceSmsInput {
  healthcareProviderId: number;
  phoneNumber: string;
  message: string;
  idempotencyKey: string;
}

const KNOWN_STATUSES = new Set(['sent', 'pending', 'failed', 'unknown', 'simulated']);

export class PrixiVoiceSmsService {
  constructor(private readonly httpClient: HttpClient = axios) {}

  async send(input: SendPrixiVoiceSmsInput): Promise<PrixiVoiceSmsResult> {
    const url = this.getApiUrl();
    const token = process.env.PRIXI_VOICE_GATEWAY_TOKEN?.trim() || process.env.PRIXI_API_KEY?.trim();

    if (!token) {
      throw new Error('PriXi Voice SMS API token is not configured');
    }

    if (!Number.isInteger(input.healthcareProviderId) || input.healthcareProviderId <= 0) {
      throw new Error('PriXi Voice SMS healthcare provider ID is invalid');
    }

    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const message = input.message.trim();
    const idempotencyKey = input.idempotencyKey.trim();

    if (!message) throw new Error('PriXi Voice SMS message is empty');
    if (!idempotencyKey) throw new Error('PriXi Voice SMS idempotency key is empty');

    const response = await this.httpClient.post<PrixiVoiceSmsResponse>(
      url,
      {
        healthcare_provider_id: input.healthcareProviderId,
        phone_number: phoneNumber,
        message,
        idempotency_key: idempotencyKey,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10_000,
      }
    );

    const status = response.data.status;
    if (!response.data.success || !status || !KNOWN_STATUSES.has(status)) {
      throw new Error(`PriXi Voice SMS API returned an invalid response${response.data.message ? `: ${response.data.message}` : ''}`);
    }

    if (status === 'failed') {
      throw new Error('PriXi Voice SMS API rejected the SMS');
    }

    return {
      smsLogId: response.data.sms_log_id,
      status,
    };
  }

  private getApiUrl(): string {
    const explicitUrl = process.env.PRIXI_VOICE_SMS_API_URL?.trim();
    if (explicitUrl) return explicitUrl;

    const baseUrl = process.env.PRIXI_API_URL?.trim();
    if (!baseUrl) throw new Error('PriXi Voice SMS API URL is not configured');

    return `${baseUrl.replace(/\/$/, '')}/api/voice/sms/send`;
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    const compact = phoneNumber.trim().replace(/[\s()-]/g, '');
    const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;

    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new Error('PriXi Voice SMS recipient phone number is invalid');
    }

    return normalized;
  }
}

export const prixiVoiceSmsService = new PrixiVoiceSmsService();
