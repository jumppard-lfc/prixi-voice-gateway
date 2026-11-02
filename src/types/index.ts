export interface OfficeHours {
  from: string; // e.g. "08:00"
  to: string;   // e.g. "15:00"
}

export interface VoiceAssistantWorkingHoursDay {
  enabled: boolean;
  from: string | null;
  to: string | null;
}

export type VoiceAssistantWorkingHours = Partial<Record<
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  VoiceAssistantWorkingHoursDay
>>;

export interface ClinicConfig {
  clinicId: string;
  voiceBotEnabled: boolean;
  enabled?: boolean;
  assistantType?: string | null;
  twilioPhoneNumber?: string | null;
  availability?: {
    status: 'open' | 'vacation' | 'outside_hours' | 'disabled';
    message?: string | null;
  };
  messages?: {
    vacation?: string | null;
    [key: string]: string | null | undefined;
  };
  workingHours?: VoiceAssistantWorkingHours;
  officeHoursNote?: string | null;
  officeHours?: {
    monday?: OfficeHours;
    tuesday?: OfficeHours;
    wednesday?: OfficeHours;
    thursday?: OfficeHours;
    friday?: OfficeHours;
    saturday?: OfficeHours;
    sunday?: OfficeHours;
  };
  allowForwardDuringOfficeHours?: boolean;
  forwardPhoneNumber?: string;
  timezone: string;
  greetingMessage?: string;
  pediatricMode?: boolean;
  professionalId?: number;
  healthcareProviderId?: number;
  bookingEnabled?: boolean;
}

export type BookingServiceCode = 'initial_exam' | 'follow_up' | 'acute_exam' | 'certificate_exam' | 'aesthetic_medicine';
export interface DatePreference { kind: 'earliest' | 'next_available'; timeOfDay?: 'morning' | 'afternoon'; }
export interface OfferedSlot { id: string; startAt: string; serviceName: string; }

export type PrixiConfig = ClinicConfig;

export type PrixiEventName = 'call_forwarded' | 'voicemail_recorded';

export interface BasePrixiEvent {
  event: PrixiEventName;
  clinicId: string;
  phone: string;
  routingPhoneNumber: string;
}

export interface CallForwardedEvent extends BasePrixiEvent {
  event: 'call_forwarded';
  forwardedTo: string;
  callSid: string;
  timestamp: string;
}

export interface VoicemailRecordedEvent extends BasePrixiEvent {
  event: 'voicemail_recorded';
  durationSeconds: number;
  callStartedAt: string;
  callEndedAt: string;
  providerCallId: string;
  nameUrl: string;
  birthYearUrl: string;
  problemUrl: string;
  nameTranscript: string;
  birthYearTranscript: string;
  problemTranscript: string;
}

export type PrixiEvent = CallForwardedEvent | VoicemailRecordedEvent;

export type CallCompletedEvent = PrixiEvent;
