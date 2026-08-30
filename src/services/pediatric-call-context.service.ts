import { DateTime } from 'luxon';

export type PediatricCallReason = 'acute' | 'planned' | 'unknown';

const ACUTE_REASON_PARTS = [
  'akut', 'chor', 'teplot', 'horuc', 'kasel', 'bolest', 'vrac', 'hnack',
  'vyraz', 'dych', 'dus', 'uraz', 'zhor', 'zapal', 'infek', 'nadch', 'sopel'
];

const PLANNED_REASON_PARTS = [
  'objedn', 'termin', 'prevent', 'prehliad', 'ockov', 'vakcin', 'novorod',
  'poradn', 'recept', 'predpis', 'vysled'
];

export const CELKOVA_CONTEXT_MESSAGES = {
  acuteBeforeNoon: 'Akútne chorí pacienti budú ošetrení do 12:00.',
  afternoonSchedule: 'Čas od 12:00 do 15:00 je vyhradený pre objednaných pacientov, novorodencov, preventívne prehliadky a očkovanie.',
  acuteAfternoon: 'Choré deti sú ošetrované denne od 7:30 do 12:00. Čas od 12:00 do 15:00 je vyhradený pre objednaných pacientov, novorodencov, preventívne prehliadky a očkovanie.',
  phoneHours: 'Telefonicky je ambulancia k dispozícii v pracovných dňoch od 7:30 do 15:00.',
  childEmergency: 'Ak ide o akútny stav, v pracovných dňoch od 16:00 do 20:00 ho ošetria na detskej pohotovosti v Žiline.',
  hospitalEmergency: 'Ak ide o urgentný stav, od 20:00 do 7:00 ho ošetruje nemocničný lekár.'
} as const;

function normalizeSlovak(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('sk-SK');
}

export function classifyPediatricCallReason(reason: string): PediatricCallReason {
  const normalizedReason = normalizeSlovak(reason);

  if (ACUTE_REASON_PARTS.some(part => normalizedReason.includes(part))) {
    return 'acute';
  }

  if (PLANNED_REASON_PARTS.some(part => normalizedReason.includes(part))) {
    return 'planned';
  }

  return 'unknown';
}

export function getCelkovaContextMessage(
  reason: string,
  now: DateTime = DateTime.now().setZone('Europe/Bratislava')
): string | null {
  if (!now.isValid) return null;

  const callReason = classifyPediatricCallReason(reason);
  const isWeekday = now.weekday <= 5;
  const minutes = now.hour * 60 + now.minute;
  const isPhoneHours = isWeekday && minutes >= 7 * 60 + 30 && minutes < 15 * 60;

  if (minutes >= 20 * 60 || minutes < 7 * 60) {
    return callReason === 'acute'
      ? CELKOVA_CONTEXT_MESSAGES.hospitalEmergency
      : isPhoneHours ? null : CELKOVA_CONTEXT_MESSAGES.phoneHours;
  }

  if (isWeekday && minutes >= 16 * 60 && minutes < 20 * 60) {
    return callReason === 'acute'
      ? CELKOVA_CONTEXT_MESSAGES.childEmergency
      : CELKOVA_CONTEXT_MESSAGES.phoneHours;
  }

  if (isWeekday && minutes >= 12 * 60 && minutes < 15 * 60) {
    if (callReason === 'acute') return CELKOVA_CONTEXT_MESSAGES.acuteAfternoon;
    if (callReason === 'planned') return CELKOVA_CONTEXT_MESSAGES.afternoonSchedule;
    return null;
  }

  if (isWeekday && minutes >= 7 * 60 + 30 && minutes < 12 * 60) {
    return callReason === 'acute' ? CELKOVA_CONTEXT_MESSAGES.acuteBeforeNoon : null;
  }

  return isPhoneHours ? null : CELKOVA_CONTEXT_MESSAGES.phoneHours;
}
