import axios, { AxiosInstance } from 'axios';
import { PrixiConfig, CallCompletedEvent } from '../types';

export class PrixiClient {
  private client: AxiosInstance;

  constructor() {
    const baseURL = process.env.PRIXI_API_URL || 'https://api.prixi.com';
    const apiKey = process.env.PRIXI_API_KEY;

    if (!apiKey) {
      console.warn('PRIXI_API_KEY is not set. Outbound requests may fail.');
    }

    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Fetches the configuration for a given phone number.
   * Has a strict 2s timeout as per requirements.
   */
  async getConfig(phoneNumber: string): Promise<PrixiConfig> {
    try {
      const response = await this.client.get<PrixiConfig>('/voice/config', {
        params: { phoneNumber },
        timeout: 2000 // Max 2s timeout limit
      });
      return response.data;
    } catch (error) {
      // In case of timeout or 5xx error, fast-fail so we can default to Voicemail
      throw new Error(`Failed to fetch config from Prixi: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Posts physical call completed events to Prixi
   */
  async reportCallCompleted(payload: CallCompletedEvent): Promise<void> {
    try {
      await this.client.post('/voice/call-completed', payload, {
        timeout: 5000 // lenient timeout for async jobs
      });
    } catch (error) {
      console.error('Failed to report call completion to Prixi', { payload, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

export const prixiClient = new PrixiClient();
