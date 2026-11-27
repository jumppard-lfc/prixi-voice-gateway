import { DateTime } from 'luxon';
import { ClinicConfig, VoiceAssistantWorkingHours, VoiceAssistantWorkingHoursDay } from '../types';
import { normalizeLenerovaSpeech } from './lenerova-nlu.service';

const dayKeys = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

type DayKey = typeof dayKeys[number];

const daySpeech: Record<DayKey, string> = {
  monday: 'V pondelok',
  tuesday: 'V utorok',
  wednesday: 'V stredu',
  thursday: 'Vo štvrtok',
  friday: 'V piatok',
  saturday: 'V sobotu',
  sunday: 'V nedeľu',
};

const requestedDayPatterns: Array<[DayKey, RegExp]> = [
  ['monday', /pondel/],
  ['tuesday', /utor/],
  ['wednesday', /stred/],
  ['thursday', /stvrt/],
  ['friday', /piat/],
  ['saturday', /sobot/],
  ['sunday', /nedel/],
];

const fallbackWorkingHours: VoiceAssistantWorkingHours = {
  monday: { enabled: true, from: '07:00', to: '12:00' },
  tuesday: { enabled: true, from: '07:00', to: '12:00' },
  wednesday: { enabled: true, from: '07:00', to: '12:00' },
  thursday: { enabled: true, from: '07:00', to: '12:00' },
  friday: { enabled: true, from: '07:00', to: '12:00' },
  saturday: { enabled: false, from: null, to: null },
  sunday: { enabled: false, from: null, to: null },
};

const hourWords: Record<number, string> = {
  0: 'nultej',
  1: 'prvej',
  2: 'druhej',
  3: 'tretej',
  4: 'štvrtej',
  5: 'piatej',
  6: 'šiestej',
  7: 'siedmej',
  8: 'ôsmej',
  9: 'deviatej',
  10: 'desiatej',
  11: 'jedenástej',
  12: 'dvanástej',
  13: 'trinástej',
  14: 'štrnástej',
  15: 'pätnástej',
  16: 'šestnástej',
  17: 'sedemnástej',
  18: 'osemnástej',
  19: 'devätnástej',
  20: 'dvadsiatej',
  21: 'dvadsiatej prvej',
  22: 'dvadsiatej druhej',
  23: 'dvadsiatej tretej',
};

const minuteWords: Record<number, string> = {
  5: 'päť',
  10: 'desať',
  15: 'pätnásť',
  20: 'dvadsať',
  25: 'dvadsaťpäť',
  30: 'tridsať',
  35: 'tridsaťpäť',
  40: 'štyridsať',
  45: 'štyridsaťpäť',
  50: 'päťdesiat',
  55: 'päťdesiatpäť',
};

function completeSchedule(schedule?: VoiceAssistantWorkingHours): VoiceAssistantWorkingHours {
  const source = schedule || fallbackWorkingHours;
  const complete = dayKeys.every(day => {
    const hours = source[day];
    return hours && typeof hours.enabled === 'boolean';
  });
  return complete ? source : fallbackWorkingHours;
}

function spokenTime(value: string): string {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const spokenHour = hourWords[hour] || hourText;
  if (!minute) return spokenHour;
  return `${spokenHour} ${minuteWords[minute] || minute}`;
}

function sameHours(
  schedule: VoiceAssistantWorkingHours,
  keys: DayKey[]
): VoiceAssistantWorkingHoursDay | undefined {
  const first = schedule[keys[0]];
  if (!first || !first.enabled || !first.from || !first.to) return undefined;
  return keys.every(key => {
    const hours = schedule[key];
    return hours?.enabled && hours.from === first.from && hours.to === first.to;
  }) ? first : undefined;
}

function responseForDay(day: DayKey, hours?: VoiceAssistantWorkingHoursDay): string {
  if (!hours?.enabled || !hours.from || !hours.to) {
    return `${daySpeech[day]} neordinujeme.`;
  }
  return `${daySpeech[day]} ordinujeme od ${spokenTime(hours.from)} do ${spokenTime(hours.to)}.`;
}

function requestedDay(question: string, now: DateTime): DayKey | undefined {
  const normalized = normalizeLenerovaSpeech(question);
  if (/\bzajtra\b/.test(normalized)) return dayKeys[now.plus({ days: 1 }).weekday - 1];
  if (/\b(dnes|teraz|aktualne|momentalne|dokedy)\b/.test(normalized)) {
    return dayKeys[now.weekday - 1];
  }
  return requestedDayPatterns.find(([, pattern]) => pattern.test(normalized))?.[0];
}

export function buildLenerovaOfficeHoursAnswer(
  config: ClinicConfig,
  question: string,
  now?: DateTime
): string {
  const timezone = config.timezone || 'Europe/Bratislava';
  const localNow = (now || DateTime.now()).setZone(timezone);
  const schedule = completeSchedule(config.workingHours);
  const day = requestedDay(question, localNow);
  if (day) return responseForDay(day, schedule[day]);

  const weekdayHours = sameHours(schedule, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  const weekendClosed = !schedule.saturday?.enabled && !schedule.sunday?.enabled;
  if (weekdayHours && weekendClosed) {
    return `Ordinačné hodiny sú od pondelka do piatka od ${spokenTime(weekdayHours.from!)} do ${spokenTime(weekdayHours.to!)}. V sobotu a v nedeľu neordinujeme.`;
  }

  return dayKeys.map(dayKey => responseForDay(dayKey, schedule[dayKey])).join(' ');
}
