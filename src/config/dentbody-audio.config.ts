export const dentbodyAudioFiles = {
  greeting: 'dentbody-01-greeting-v1.wav',
  followUp: 'dentbody-02-follow-up-v1.wav',
  continue: 'dentbody-03-continue-v1.wav',
  retry: 'dentbody-04-retry-v1.wav',
  fallback: 'dentbody-05-fallback-v1.wav',
  closing: 'dentbody-06-closing-v1.wav',
  expired: 'dentbody-07-expired-v1.wav',
  technical: 'dentbody-08-technical-v1.wav',
  appointment: 'dentbody-09-appointment-v1.wav',
  referral: 'dentbody-10-referral-v1.wav',
  address: 'dentbody-11-address-v1.wav',
  floor: 'dentbody-12-floor-v1.wav',
  patients: 'dentbody-13-patients-v1.wav',
  payment: 'dentbody-14-payment-v1.wav',
  dentalImages: 'dentbody-15-dental-images-v1.wav',
  generalImages: 'dentbody-16-general-images-v1.wav',
  radiologyReport: 'dentbody-17-radiology-report-v1.wav',
  certificate: 'dentbody-18-certificate-v1.wav',
  retrospectiveImage: 'dentbody-19-retrospective-image-v1.wav',
  contact: 'dentbody-20-contact-v1.wav',
  pricing: 'dentbody-21-pricing-v1.wav',
  medicalAdvice: 'dentbody-22-medical-advice-v1.wav',
  hoursFullWeek: 'dentbody-23-hours-full-week-v1.wav',
  hoursMonday: 'dentbody-24-hours-monday-v1.wav',
  hoursTuesday: 'dentbody-25-hours-tuesday-v1.wav',
  hoursWednesday: 'dentbody-26-hours-wednesday-v1.wav',
  hoursThursday: 'dentbody-27-hours-thursday-v1.wav',
  hoursFriday: 'dentbody-28-hours-friday-v1.wav',
  hoursSaturday: 'dentbody-29-hours-saturday-v1.wav',
  hoursSunday: 'dentbody-30-hours-sunday-v1.wav',
  hoursWeekend: 'dentbody-31-hours-weekend-v1.wav',
  todaySaturdayClosed: 'dentbody-32-today-saturday-closed-v1.wav',
  todaySundayClosed: 'dentbody-33-today-sunday-closed-v1.wav',
  openMondayMorning: 'dentbody-34-open-monday-morning-v1.wav',
  openTuesdayThursdayMorning: 'dentbody-35-open-tuesday-thursday-morning-v1.wav',
  openMondayAfternoon: 'dentbody-36-open-monday-afternoon-v1.wav',
  openTuesdayThursdayAfternoon: 'dentbody-37-open-tuesday-thursday-afternoon-v1.wav',
  openFriday: 'dentbody-38-open-friday-v1.wav',
  lunchMonday: 'dentbody-39-lunch-monday-v1.wav',
  lunchTuesdayThursday: 'dentbody-40-lunch-tuesday-thursday-v1.wav',
  opensToday: 'dentbody-41-opens-today-v1.wav',
  closedToday: 'dentbody-42-closed-today-v1.wav',
} as const;

export type DentbodyAudioKey = keyof typeof dentbodyAudioFiles;

export const dentbodyAudioFileNames = Object.values(dentbodyAudioFiles);

export function dentbodyAudioMediaPath(key: DentbodyAudioKey): string {
  return `/media/${dentbodyAudioFiles[key]}`;
}
