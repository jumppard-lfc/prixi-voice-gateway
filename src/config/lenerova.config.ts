export type LenerovaRequestType =
  | 'prescription'
  | 'appointment'
  | 'appointment_change'
  | 'worsening'
  | 'administration'
  | 'new_patient'
  | 'information';

export const lenerovaBotConfig = {
  id: 'mudr-slavka-lenerova-psychiatria',
  clinic: {
    clinicId: '172',
    assistantType: 'lenerova',
    displayName: 'psychiatrická ambulancia MUDr. Slávky Lenerovej',
    specialty: 'psychiatria pre dospelých',
    inboundTwilioNumber: '+420910924316',
    routingPhoneNumber: '+421907808677',
    timezone: 'Europe/Bratislava',
  },
  booking: {
    enabled: false,
  },
} as const;

export const lenerovaRequestLabels: Record<LenerovaRequestType, string> = {
  prescription: 'žiadosť o opakovaný recept',
  appointment: 'žiadosť o termín kontroly',
  appointment_change: 'zmena alebo zrušenie existujúceho termínu',
  worsening: 'zhoršenie stavu alebo problém s liekom',
  administration: 'lekárska správa, potvrdenie alebo iná administratíva',
  new_patient: 'žiadosť nového pacienta',
  information: 'organizačná informácia',
};
