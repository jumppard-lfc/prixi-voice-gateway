export type MalakovaRequestType = 'appointment' | 'prescription' | 'contact';

export type MalakovaAppointmentType =
  | 'health_problem'
  | 'certificate'
  | 'preoperative_exam'
  | 'preventive_exam'
  | 'other';

/**
 * Live availability and booking are intentionally disabled. The gateway does
 * not currently have a reviewed clinic-scoped calendar API, so appointment
 * branches create a PriXi callback request instead of claiming a reservation.
 */
export const malakovaBotConfig = {
  id: 'mudr-malakova-vseobecna-ambulancia',
  clinic: {
    clinicId: '161',
    displayName: 'ambulancia MUDr. Malákovej',
    specialty: 'všeobecná ambulancia pre dospelých',
    inboundTwilioNumber: '+420910923456',
    routingPhoneNumber: '+421907692661',
    timezone: 'Europe/Bratislava',
  },
  booking: {
    enabled: false,
    durationsMinutes: {
      health_problem: 20,
      certificate: 15,
    },
  },
} as const;
