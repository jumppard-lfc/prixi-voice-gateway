import axios from 'axios';

export interface DemoLead {
  botId: string;
  callSid: string;
  callerPhone: string;
  capturedAt: string;
  name?: string;
  clinicName?: string;
  clinicType?: string;
  preferredContactTime?: string;
}

/**
 * Sends presentation leads to an optional HTTPS webhook. The structured log is
 * always emitted as a short-term operational fallback for the event demo.
 */
export class DemoLeadService {
  async submit(lead: DemoLead): Promise<'webhook' | 'log'> {
    const webhookUrl = process.env.DEMO_LEAD_WEBHOOK_URL?.trim();
    console.info('[PriXi Demo Lead]', JSON.stringify(lead));
    if (!webhookUrl || process.env.NODE_ENV === 'test') return 'log';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = process.env.DEMO_LEAD_WEBHOOK_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    await axios.post(webhookUrl, lead, { headers, timeout: 5_000 });
    return 'webhook';
  }
}

export const demoLeadService = new DemoLeadService();
