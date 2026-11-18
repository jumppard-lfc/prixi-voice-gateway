export type StefancikRequestType = 'appointment' | 'results' | 'prescription' | 'office_hours';

export const stefancikBotConfig = {
  id: 'mudr-jan-stefancik-stupava',
  clinic: {
    clinicId: '171',
    displayName: 'urologicko-andrologická ambulancia MUDr. Jána Štefančíka',
    inboundTwilioNumber: '+420910927214',
    routingPhoneNumber: '+421907875703',
    timezone: 'Europe/Bratislava',
  },
  booking: {
    url: 'https://www.ecakaren.sk/lekari/jan-stefancik/',
    sms: 'Dobrý deň, na vyšetrenie u MUDr. Jána Štefančíka sa môžete objednať cez eČakáreň: https://www.ecakaren.sk/lekari/jan-stefancik/',
  },
  requestWindow: {
    from: '07:30',
    to: '10:30',
  },
  resultsPhoneWindow: {
    from: '10:30',
    to: '12:00',
  },
} as const;

export const stefancikRequestLabels: Record<StefancikRequestType, string> = {
  appointment: 'A) Žiadosť o termín',
  results: 'B) Žiadosť o výsledky',
  prescription: 'C) Žiadosť o lieky / recept',
  office_hours: 'D) Ordinačné hodiny',
};
