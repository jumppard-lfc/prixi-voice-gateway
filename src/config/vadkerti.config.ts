import { OfficeHours } from '../types';

export type VadkertiLanguage = 'sk' | 'hu';

export type VadkertiRequestType =
  | 'new_patient_no_neurologist'
  | 'new_to_clinic_seen_neurologist'
  | 'existing_patient_follow_up'
  | 'follow_up_with_results'
  | 'procedure_or_therapy'
  | 'prescription'
  | 'medical_report'
  | 'appointment_change_or_cancellation'
  | 'other';

export interface VadkertiBotConfig {
  id: string;
  clinic: {
    displayName: string;
    specialty: string;
    inboundTwilioNumber: string;
    routingPhoneNumber: string;
    timezone: string;
  };
  languages: VadkertiLanguage[];
  businessHours: Record<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday', OfficeHours | undefined>;
  closedDates: string[];
  requestTypes: VadkertiRequestType[];
  prescription: {
    requiresCurrentClinicExamination: true;
    standardHandling: 'same_day_afternoon';
  };
  futureBookingPolicy: {
    enabled: false;
    provider: 'curo';
    slotDurationMinutes: 20;
    maxAdvanceMonths: 3;
    routing: Record<Exclude<VadkertiRequestType, 'prescription' | 'medical_report' | 'appointment_change_or_cancellation' | 'other'>, string>;
  };
}

/**
 * Production configuration for MUDr. Peter Vadkerti.
 *
 * The future booking policy is intentionally inert. It documents the mapping
 * needed by a later Curo connector without exposing availability or creating,
 * changing, or cancelling an appointment today.
 */
export const vadkertiBotConfig: VadkertiBotConfig = {
  id: 'mudr-peter-vadkerti',
  clinic: {
    displayName: 'neurologická ambulancia MUDr. Petra Vadkertiho',
    specialty: 'neurológia',
    inboundTwilioNumber: '+420910922693',
    routingPhoneNumber: '+421902647072',
    timezone: 'Europe/Bratislava',
  },
  languages: ['sk', 'hu'],
  businessHours: {
    monday: { from: '07:30', to: '12:00' },
    tuesday: { from: '07:30', to: '12:00' },
    wednesday: { from: '07:30', to: '12:00' },
    thursday: { from: '07:30', to: '12:00' },
    friday: { from: '07:30', to: '12:00' },
    saturday: undefined,
    sunday: undefined,
  },
  closedDates: [],
  requestTypes: [
    'new_patient_no_neurologist',
    'new_to_clinic_seen_neurologist',
    'existing_patient_follow_up',
    'follow_up_with_results',
    'procedure_or_therapy',
    'prescription',
    'medical_report',
    'appointment_change_or_cancellation',
    'other',
  ],
  prescription: {
    requiresCurrentClinicExamination: true,
    standardHandling: 'same_day_afternoon',
  },
  futureBookingPolicy: {
    enabled: false,
    provider: 'curo',
    slotDurationMinutes: 20,
    maxAdvanceMonths: 3,
    routing: {
      new_patient_no_neurologist: 'first_three_morning_slots',
      new_to_clinic_seen_neurologist: 'remaining_morning_slots',
      existing_patient_follow_up: 'morning_slots',
      follow_up_with_results: 'first_two_afternoon_slots_from_13_00',
      procedure_or_therapy: 'following_afternoon_slots',
    },
  },
};
