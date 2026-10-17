export type KollarRequestType =
  | 'acute_problem'
  | 'prescription'
  | 'results'
  | 'appointment'
  | 'new_patient'
  | 'office_hours'
  | 'human_message';

export const kollarBotConfig = {
  id: 'mudr-kollar-prva-zenska',
  clinic: {
    clinicId: '155',
    displayName: 'gynekologická ambulancia MUDr. Kollára',
    specialty: 'gynekológia',
    inboundTwilioNumber: '+420910922076',
    timezone: 'Europe/Bratislava',
  },
} as const;
