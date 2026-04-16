export interface OfficeHours {
  from: string; // e.g. "08:00"
  to: string;   // e.g. "15:00"
}

export interface ClinicConfig {
  clinicId: string;
  voiceBotEnabled: boolean;
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
}

export type PrixiConfig = ClinicConfig;

export type PrixiEventName = 'call_forwarded' | 'voicemail_recorded';

export interface BasePrixiEvent {
  event: PrixiEventName;
  clinicId: string;
  phone: string;
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
  audioUrl: string;
  transcript: string;
}

export type PrixiEvent = CallForwardedEvent | VoicemailRecordedEvent;

export type CallCompletedEvent = PrixiEvent;
