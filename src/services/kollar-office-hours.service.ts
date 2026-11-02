import { VoiceAssistantWorkingHours } from '../types';

export interface KollarOfficeHoursConfig {
  clinicId: string;
  assistantType?: string | null;
  enabled?: boolean;
  voiceBotEnabled?: boolean;
  workingHours?: VoiceAssistantWorkingHours;
  officeHoursNote?: string | null;
}

const DAYS = [
  ['monday', 'V pondelok'],
  ['tuesday', 'V utorok'],
  ['wednesday', 'V stredu'],
  ['thursday', 'Vo štvrtok'],
  ['friday', 'V piatok'],
  ['saturday', 'V sobotu'],
  ['sunday', 'V nedeľu'],
] as const;

const HOUR_WORDS = [
  'polnoci', 'jednej', 'druhej', 'tretej', 'štvrtej', 'piatej',
  'šiestej', 'siedmej', 'ôsmej', 'deviatej', 'desiatej', 'jedenástej',
  'dvanástej', 'trinástej', 'štrnástej', 'pätnástej', 'šestnástej',
  'sedemnástej', 'osemnástej', 'devätnástej', 'dvadsiatej',
  'dvadsiatej prvej', 'dvadsiatej druhej', 'dvadsiatej tretej',
];

function spokenTime(value: string): string | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return undefined;
  }
  return minute === 0
    ? HOUR_WORDS[hour]
    : `${HOUR_WORDS[hour]} hodiny a ${minute} minút`;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function buildKollarOfficeHoursMessage(config: KollarOfficeHoursConfig): string | undefined {
  if (
    String(config.clinicId) !== '155'
    || config.assistantType !== 'kollar'
    || config.enabled === false
    || config.voiceBotEnabled === false
    || !config.workingHours
  ) {
    return undefined;
  }

  const schedule = DAYS.map(([key, label]) => {
    const hours = config.workingHours?.[key];
    if (!hours?.enabled) return `${label} neordinujeme.`;
    const from = hours.from ? spokenTime(hours.from) : undefined;
    const to = hours.to ? spokenTime(hours.to) : undefined;
    if (!from || !to) return undefined;
    return `${label} ordinujeme od ${from} do ${to}.`;
  });

  if (schedule.some(value => !value)) return undefined;

  const note = sentence(config.officeHoursNote || '');
  return [
    'Ordinačné hodiny sú:',
    ...schedule,
    ...(note ? [note] : []),
    'Verím že som vám pomohla a prajem ešte pekný zvyšok dňa. Dovidenia.',
  ].join(' ');
}
