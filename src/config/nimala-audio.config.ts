export const nimalaAudioFiles = {
  greeting: 'nimala-01-greeting-v1.wav',
  urologyMenu: 'nimala-02-urology-menu-v1.wav',
  appointmentType: 'nimala-03-appointment-type-v1.wav',
  askName: 'nimala-04-ask-name-v1.wav',
  askBirthYear: 'nimala-05-ask-birth-year-v1.wav',
  prescriptionDetail: 'nimala-06-prescription-detail-v1.wav',
  resultsDetail: 'nimala-07-results-detail-v1.wav',
  retry: 'nimala-08-retry-v1.wav',
  selectDifferentSlot: 'nimala-09-select-different-slot-v1.wav',
  slotBecameUnavailable: 'nimala-10-slot-became-unavailable-v1.wav',
  transferStart: 'nimala-11-transfer-start-v1.wav',
  farewell: 'nimala-12-farewell-v1.wav',
  prescriptionComplete: 'nimala-13-prescription-complete-v1.wav',
  resultsComplete: 'nimala-14-results-complete-v1.wav',
  transferComplete: 'nimala-15-transfer-complete-v1.wav',
  aestheticsUnavailable: 'nimala-16-aesthetics-unavailable-v1.wav',
  ultrasoundUnavailable: 'nimala-17-ultrasound-unavailable-v1.wav',
  proctologyUnavailable: 'nimala-18-proctology-unavailable-v1.wav',
  dermatologyUnavailable: 'nimala-19-dermatology-unavailable-v1.wav',
  noFreeSlot: 'nimala-20-no-free-slot-v1.wav',
  transferUnavailable: 'nimala-21-transfer-unavailable-v1.wav',
  transferNotAnswered: 'nimala-22-transfer-not-answered-v1.wav',
  expired: 'nimala-23-call-expired-v1.wav',
  technical: 'nimala-24-calendar-technical-problem-v1.wav',
  startupTechnical: 'nimala-25-startup-technical-problem-v1.wav',
  bookingStatusUncertain: 'nimala-26-booking-status-uncertain-v1.wav',
  noSlotInSession: 'nimala-27-no-slot-in-session-v1.wav',
} as const;

export type NimalaAudioKey = keyof typeof nimalaAudioFiles;

export const nimalaAudioFileNames = Object.values(nimalaAudioFiles);

export function nimalaAudioMediaPath(key: NimalaAudioKey): string {
  return `/media/${nimalaAudioFiles[key]}`;
}
