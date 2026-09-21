export type NeurocentrumRequestType = 'prescription' | 'follow_up' | 'results';

export interface NeurocentrumBotConfig {
  id: string;
  clinic: {
    displayName: string;
    doctorName: string;
    inboundTwilioNumber: string;
    routingPhoneNumber: string;
  };
}

/**
 * The clinic number is the authoritative carrier fallback. The dedicated
 * Twilio DID is deployment-specific and must be supplied after it is assigned.
 */
export const neurocentrumBotConfig: NeurocentrumBotConfig = {
  id: 'neurocentrum-levice',
  clinic: {
    displayName: 'NEUROCENTRUM Levice',
    doctorName: 'MUDr. Gabriela Paluch Kubišová',
    inboundTwilioNumber: process.env.NEUROCENTRUM_TWILIO_PHONE_NUMBER?.trim() || '',
    routingPhoneNumber: '+421948914896',
  },
};
