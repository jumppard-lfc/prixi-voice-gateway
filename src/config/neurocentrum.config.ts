export type NeurocentrumRequestType = 'prescription' | 'follow_up' | 'results';

export interface NeurocentrumBotConfig {
  id: string;
  clinic: {
    displayName: string;
    doctorName: string;
    routingPhoneNumber: string;
  };
}

export const neurocentrumBotConfig: NeurocentrumBotConfig = {
  id: 'neurocentrum-levice',
  clinic: {
    displayName: 'NEUROCENTRUM Levice',
    doctorName: 'MUDr. Gabriela Paluch Kubišová',
    routingPhoneNumber: '+421948914896',
  },
};
