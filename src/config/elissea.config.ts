export type ElisseaRequestType =
  | 'appointment'
  | 'prescription'
  | 'sick_leave'
  | 'results'
  | 'certificate'
  | 'other'
  | 'new_patient';

export type ElisseaAppointmentType =
  | 'acute_exam'
  | 'control_exam'
  | 'blood_draw'
  | 'vaccination'
  | 'preventive_exam';

/**
 * Elissea's appointment connector is intentionally disabled. Until PriXi
 * exposes a clinic-scoped availability and booking API, the bot creates a
 * callback request and never claims that an appointment was reserved.
 */
export const elisseaBotConfig = {
  id: 'elissea-clinic',
  clinic: {
    clinicId: '148',
    displayName: 'Elissea Clinic',
    specialty: 'všeobecná ambulancia pre dospelých',
    inboundTwilioNumber: '+420910927882',
    timezone: 'Europe/Bratislava',
  },
  booking: {
    enabled: false,
    maxAdvanceMonths: 3,
  },
} as const;
