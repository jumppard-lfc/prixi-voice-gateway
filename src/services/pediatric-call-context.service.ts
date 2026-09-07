import { DateTime } from 'luxon';

export const CELKOVA_CONTEXT_MESSAGES = {
  acuteBeforeNoon: 'Akútne chorí pacienti budú ošetrení do 12:00.',
  afternoonSchedule: 'Čas od 12:00 do 15:00 je vyhradený pre objednaných pacientov, novorodencov, preventívne prehliadky a očkovanie.',
  beforePhoneHours: 'Telefonicky je ambulancia k dispozícii v pracovných dňoch od 7:30 do 15:00. Akútne chorí pacienti budú ošetrení do 12:00.',
  phoneHours: 'Telefonicky je ambulancia k dispozícii v pracovných dňoch od 7:30 do 15:00.',
  childEmergency: 'Ak ide o akútny stav, v pracovných dňoch od 16:00 do 20:00 ho ošetria na detskej pohotovosti v Žiline.',
  hospitalEmergency: 'Ak ide o urgentný stav, od 20:00 do 7:00 ho ošetruje nemocničný lekár.'
} as const;

export function getCelkovaTimeMessage(
  now: DateTime = DateTime.now().setZone('Europe/Bratislava')
): string {
  if (!now.isValid) return CELKOVA_CONTEXT_MESSAGES.phoneHours;

  const isWeekday = now.weekday <= 5;
  const minutes = now.hour * 60 + now.minute;

  if (minutes >= 20 * 60 || minutes < 7 * 60) {
    return CELKOVA_CONTEXT_MESSAGES.hospitalEmergency;
  }

  if (!isWeekday) {
    return CELKOVA_CONTEXT_MESSAGES.phoneHours;
  }

  if (minutes < 7 * 60 + 30) {
    return CELKOVA_CONTEXT_MESSAGES.beforePhoneHours;
  }

  if (minutes < 12 * 60) {
    return CELKOVA_CONTEXT_MESSAGES.acuteBeforeNoon;
  }

  if (minutes < 15 * 60) {
    return CELKOVA_CONTEXT_MESSAGES.afternoonSchedule;
  }

  if (minutes < 16 * 60) {
    return CELKOVA_CONTEXT_MESSAGES.phoneHours;
  }

  return CELKOVA_CONTEXT_MESSAGES.childEmergency;
}
