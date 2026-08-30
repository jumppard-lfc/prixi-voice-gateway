import axios from 'axios';

const BULKGATE_TRANSACTIONAL_URL = 'https://portal.bulkgate.com/api/2.0/advanced/transactional';
const SUCCESS_STATUSES = new Set(['accepted', 'sent', 'scheduled']);

type HttpClient = {
  post<T>(url: string, data: unknown, config?: unknown): Promise<{ data: T }>;
};

interface BulkGateResponseItem {
  status?: string;
  message_id?: string;
  number?: string;
}

interface BulkGateResponse {
  data?: {
    response?: BulkGateResponseItem[];
  };
  type?: string;
  error?: string;
}

export interface SmsSendResult {
  messageId?: string;
  status: string;
}

export class BulkGateSmsService {
  constructor(private readonly httpClient: HttpClient = axios) {}

  async sendTransactionalSms(to: string, text: string, tag = 'klostermann-missed-call'): Promise<SmsSendResult> {
    const applicationId = process.env.BULKGATE_APPLICATION_ID;
    const applicationToken = process.env.BULKGATE_APPLICATION_TOKEN;
    const sender = process.env.BULKGATE_SMS_SENDER || 'Klostermann';

    if (!applicationId || !applicationToken) {
      throw new Error('BulkGate SMS credentials are not configured');
    }

    const number = this.normalizePhoneNumber(to);
    const response = await this.httpClient.post<BulkGateResponse>(
      BULKGATE_TRANSACTIONAL_URL,
      {
        application_id: applicationId,
        application_token: applicationToken,
        number,
        text,
        duplicates_check: 'on',
        tag,
        channel: {
          sms: {
            sender_id: 'gText',
            sender_id_value: sender,
            unicode: true
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        timeout: 10_000
      }
    );

    const result = response.data.data?.response?.[0];
    if (!result?.status || !SUCCESS_STATUSES.has(result.status)) {
      const reason = result?.status || response.data.type || response.data.error || 'unknown_error';
      throw new Error(`BulkGate rejected SMS: ${reason}`);
    }

    return {
      messageId: result.message_id,
      status: result.status
    };
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    const normalized = phoneNumber.replace(/[^0-9]/g, '');

    if (normalized.length < 8 || normalized.length > 15) {
      throw new Error('SMS recipient phone number is invalid');
    }

    return normalized;
  }
}

export const bulkGateSmsService = new BulkGateSmsService();
