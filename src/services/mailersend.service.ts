import axios from 'axios';
import { DateTime } from 'luxon';
import { VoicemailRecordedEvent } from '../types';

const MAILERSEND_EMAIL_URL = 'https://api.mailersend.com/v1/email';
const ZDRAHALOVA_NOTIFICATION_EMAIL = 'pediatriamaneli@gmail.com';
const MAX_ATTEMPTS = 3;

type RequestPresentation = {
  label: string;
  icon: string;
  color: string;
  backgroundColor: string;
};

const ZDRAHALOVA_REQUEST_PRESENTATIONS: Array<RequestPresentation & { matches: RegExp }> = [
  {
    label: 'Predpis / recept',
    icon: '🔵',
    color: '#1d4ed8',
    backgroundColor: '#eff6ff',
    matches: /predpis|recept/i,
  },
  {
    label: 'Konzultácia',
    icon: '🟠',
    color: '#c2410c',
    backgroundColor: '#fff7ed',
    matches: /konzult/i,
  },
  {
    label: 'Preobjednanie preventívnej prehliadky',
    icon: '🟣',
    color: '#7e22ce',
    backgroundColor: '#faf5ff',
    matches: /prevent[ií]v/i,
  },
  {
    label: 'Predoperačné vyšetrenie / kontrolné odbery',
    icon: '🟢',
    color: '#15803d',
    backgroundColor: '#f0fdf4',
    matches: /predopera[cč]|kontroln[eé]\s+odber/i,
  },
];

const DEFAULT_REQUEST_PRESENTATION: RequestPresentation = {
  label: 'Telefonická požiadavka',
  icon: '⚪',
  color: '#475569',
  backgroundColor: '#f8fafc',
};

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseZdrahalovaTranscript(value: string): {
  presentation: RequestPresentation;
  request: string;
} {
  const transcript = value.trim();
  const category = transcript.match(/^Kategória:\s*(.+)$/im)?.[1]?.trim() || '';
  const request = transcript.match(/^Požiadavka:\s*([\s\S]*)$/im)?.[1]?.trim()
    || transcript
      .split('\n')
      .filter(line => !/^\s*\[Voice-bot[^\]]*\]\s*$/i.test(line))
      .filter(line => !/^Kategória:/i.test(line))
      .join('\n')
      .trim()
    || 'Automatický prepis nie je dostupný. Požiadavku si, prosím, otvorte v PriXi.';
  const presentation = ZDRAHALOVA_REQUEST_PRESENTATIONS.find(item => item.matches.test(category))
    || DEFAULT_REQUEST_PRESENTATION;

  return { presentation, request };
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
    const { presentation, request } = parseZdrahalovaTranscript(event.problemTranscript);
    const safePhone = escapeHtml(event.phone);
    const safeCallTime = escapeHtml(callTime);
    const safeRequest = escapeHtml(request).replace(/\n/g, '<br>');
    const telephoneHref = event.phone.replace(/[^+\d]/g, '');
    const footerText = `Prosím, neodpovedajte na tento e-mail. V prípade potreby kontaktovania pacienta zavolajte priamo pacientovi na ${event.phone}.`;

    const payload = {
      from: { email: fromEmail, name: fromName },
      to: [{ email: recipient, name: 'Detská ambulancia Maneli' }],
      subject: `${presentation.icon} ${presentation.label} – PriXi telefonická požiadavka`,
      text: [
        'Dobrý deň,',
        '',
        'PriXi zaznamenala novú telefonickú požiadavku.',
        '',
        `Typ požiadavky: ${presentation.label}`,
        `Čas hovoru: ${callTime}`,
        `Telefón volajúceho: ${event.phone}`,
        '',
        'POŽIADAVKA',
        request,
        '',
        'Požiadavka bola zároveň uložená v PriXi.',
        '',
        footerText,
      ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n'),
      html: [
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#172033;line-height:1.5;max-width:680px;margin:0 auto;">',
        '<p>Dobrý deň,</p>',
        '<p>PriXi zaznamenala novú telefonickú požiadavku.</p>',
        '<table role="presentation" style="border-collapse:collapse;margin:20px 0;width:100%;font-size:15px;">',
        `<tr><td style="padding:6px 16px 6px 0;color:#64748b;width:150px;">Typ požiadavky</td><td style="padding:6px 0;font-weight:700;color:${presentation.color};">${presentation.icon} ${escapeHtml(presentation.label)}</td></tr>`,
        `<tr><td style="padding:6px 16px 6px 0;color:#64748b;">Čas hovoru</td><td style="padding:6px 0;">${safeCallTime}</td></tr>`,
        `<tr><td style="padding:6px 16px 6px 0;color:#64748b;">Telefón volajúceho</td><td style="padding:6px 0;"><a href="tel:${telephoneHref}" style="color:#2563eb;text-decoration:none;">${safePhone}</a></td></tr>`,
        '</table>',
        `<div style="margin:24px 0;padding:18px 20px;border-left:5px solid ${presentation.color};background:${presentation.backgroundColor};border-radius:6px;">`,
        '<div style="margin-bottom:6px;font-size:12px;font-weight:700;letter-spacing:0.08em;color:#64748b;">POŽIADAVKA</div>',
        `<div style="font-size:20px;font-weight:700;line-height:1.45;color:#172033;">${safeRequest}</div>`,
        '</div>',
        '<p style="color:#475569;">Požiadavka bola zároveň uložená v PriXi.</p>',
        '<hr style="margin:28px 0 16px;border:0;border-top:1px solid #e2e8f0;">',
        `<p style="margin:0;font-size:13px;font-style:italic;color:#64748b;">Prosím, neodpovedajte na tento e-mail. V prípade potreby kontaktovania pacienta zavolajte priamo pacientovi na <a href="tel:${telephoneHref}" style="color:#2563eb;">${safePhone}</a>.</p>`,
        '</div>',
      ].join(''),
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
