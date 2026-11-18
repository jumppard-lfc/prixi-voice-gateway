import axios from 'axios';
import { DateTime } from 'luxon';
import { VoicemailRecordedEvent } from '../types';

const MAILERSEND_EMAIL_URL = 'https://api.mailersend.com/v1/email';
const ZDRAHALOVA_NOTIFICATION_EMAIL = 'matoskok1@gmail.com';
const MAX_ATTEMPTS = 3;

type HttpResponse = {
  status: number;
  headers?: Record<string, unknown>;
  data?: unknown;
};

type HttpClient = {
  post(url: string, data: unknown, config?: unknown): Promise<HttpResponse>;
};

type Wait = (milliseconds: number) => Promise<void>;

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export class MailerSendService {
  constructor(
    private readonly httpClient: HttpClient = axios,
    private readonly wait: Wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  ) { }

  isConfigured(): boolean {
    return Boolean(
      process.env.MAILERSEND_API_TOKEN?.trim()
      && process.env.MAILERSEND_FROM_EMAIL?.trim()
    );
  }

  async sendZdrahalovaRequest(event: VoicemailRecordedEvent): Promise<string> {
    const apiToken = process.env.MAILERSEND_API_TOKEN?.trim();
    const fromEmail = process.env.MAILERSEND_FROM_EMAIL?.trim();
    const fromName = process.env.MAILERSEND_FROM_NAME?.trim() || 'PriXi';
    const recipient = ZDRAHALOVA_NOTIFICATION_EMAIL;

    if (!apiToken || !fromEmail) {
      throw new Error('MailerSend credentials and sender are not configured');
    }
    if (!isEmail(fromEmail) || !isEmail(recipient)) {
      throw new Error('MailerSend sender or recipient email is invalid');
    }

    const localStartedAt = DateTime.fromISO(event.callStartedAt, { setZone: true })
      .setZone('Europe/Bratislava');
    const callTime = localStartedAt.isValid
      ? localStartedAt.toFormat('dd. MM. yyyy HH:mm')
      : event.callStartedAt;
    const transcript = event.problemTranscript.trim()
      || 'Automatický prepis nie je dostupný. Požiadavku si, prosím, otvorte v PriXi.';

    const payload = {
      from: { email: fromEmail, name: fromName },
      to: [{ email: recipient, name: 'Detská ambulancia Maneli' }],
      subject: 'PriXi: nová telefonická požiadavka',
      text: [
        'Dobrý deň,',
        '',
        'PriXi zaznamenala novú telefonickú požiadavku.',
        '',
        `Čas hovoru: ${callTime}`,
        `Telefón volajúceho: ${event.phone}`,
        '',
        transcript,
        '',
        event.problemUrl ? `Nahrávka: ${event.problemUrl}` : '',
        '',
        'Požiadavka bola zároveň uložená v PriXi.',
      ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n'),
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.httpClient.post(
          MAILERSEND_EMAIL_URL,
          payload,
          {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 10_000,
          }
        );

        const messageId = response.headers?.['x-message-id'];
        if (response.status !== 202 || typeof messageId !== 'string' || !messageId.trim()) {
          throw new Error(`MailerSend did not queue the email (status ${response.status})`);
        }
        return messageId;
      } catch (error) {
        const status = getHttpStatus(error);
        if (error instanceof Error && error.message.startsWith('MailerSend did not queue')) {
          throw error;
        }
        if (attempt < MAX_ATTEMPTS && isRetryable(status)) {
          await this.wait(attempt * 250);
          continue;
        }
        throw new Error(`MailerSend email request failed (${status ?? 'network error'})`);
      }
    }

    throw new Error('MailerSend email request failed');
  }
}

export const mailerSendService = new MailerSendService();
