import { DateTime } from 'luxon';
import { stefancikBotConfig } from '../config/stefancik.config';
import { ClinicConfig, VoiceAssistantWorkingHours } from '../types';

const DAYS = [
  ['monday', 'V pondelok'],
  ['tuesday', 'V utorok'],
  ['wednesday', 'V stredu'],
  ['thursday', 'Vo štvrtok'],
  ['friday', 'V piatok'],
  ['saturday', 'V sobotu'],
  ['sunday', 'V nedeľu'],
] as const;

export const STEFANCIK_FALLBACK_WORKING_HOURS: VoiceAssistantWorkingHours = {
  monday: { enabled: true, from: '07:30', to: '12:00' },
  tuesday: { enabled: true, from: '13:00', to: '16:00' },
  wednesday: { enabled: true, from: '07:30', to: '12:00' },
  thursday: { enabled: true, from: '07:30', to: '12:00' },
  friday: { enabled: true, from: '07:30', to: '12:00' },
  saturday: { enabled: false, from: null, to: null },
  sunday: { enabled: false, from: null, to: null },
};

const HOUR_WORDS = [
  'polnoci', 'jednej', 'druhej', 'tretej', 'štvrtej', 'piatej', 'šiestej', 'siedmej',
  'ôsmej', 'deviatej', 'desiatej', 'jedenástej', 'dvanástej', 'trinástej', 'štrnástej',
  'pätnástej', 'šestnástej', 'sedemnástej', 'osemnástej', 'devätnástej', 'dvadsiatej',
  'dvadsiatej prvej', 'dvadsiatej druhej', 'dvadsiatej tretej',
];

function minutes(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function completeSchedule(value: VoiceAssistantWorkingHours | undefined): value is VoiceAssistantWorkingHours {
  return Boolean(value) && DAYS.every(([day]) => {
    const hours = value?.[day];
    if (!hours) return false;
    if (!hours.enabled) return true;
    const from = minutes(hours.from);
    const to = minutes(hours.to);
    return from !== undefined && to !== undefined && from < to;
  });
}

export function stefancikWorkingHours(config?: ClinicConfig): VoiceAssistantWorkingHours {
  return completeSchedule(config?.workingHours) ? config.workingHours : STEFANCIK_FALLBACK_WORKING_HOURS;
}

export function isStefancikOfficeOpen(config: ClinicConfig, now: DateTime = DateTime.now()): boolean {
  if (config.enabled === false || config.voiceBotEnabled === false) return false;
  if (config.availability?.status && config.availability.status !== 'open') return false;
  const localNow = now.setZone(config.timezone || stefancikBotConfig.clinic.timezone);
  const hours = stefancikWorkingHours(config)[DAYS[localNow.weekday - 1][0]];
  const from = minutes(hours?.from);
  const to = minutes(hours?.to);
  const current = localNow.hour * 60 + localNow.minute;
  return Boolean(hours?.enabled && from !== undefined && to !== undefined && current >= from && current < to);
}

export function isStefancikRequestWindowOpen(config: ClinicConfig, now: DateTime = DateTime.now()): boolean {
  if (config.enabled === false || config.voiceBotEnabled === false) return false;
  if (config.availability?.status === 'vacation' || config.availability?.status === 'disabled') return false;
  const localNow = now.setZone(config.timezone || stefancikBotConfig.clinic.timezone);
  if (localNow.weekday > 5) return false;
  const from = minutes(stefancikBotConfig.requestWindow.from)!;
  const to = minutes(stefancikBotConfig.requestWindow.to)!;
  const current = localNow.hour * 60 + localNow.minute;
  return current >= from && current < to;
}

function spokenTime(value: string): string | undefined {
  const parsed = minutes(value);
  if (parsed === undefined) return undefined;
  const hour = Math.floor(parsed / 60);
  const minute = parsed % 60;
  if (minute === 0) return HOUR_WORDS[hour];
  if (minute === 30) return `${HOUR_WORDS[hour]} tridsať`;
  return `${HOUR_WORDS[hour]} hodiny a ${minute} minút`;
}

export function buildStefancikOfficeHoursMessage(config?: ClinicConfig): string {
  const schedule = stefancikWorkingHours(config);
  const lines = DAYS.map(([day, label]) => {
    const hours = schedule[day];
    if (!hours?.enabled) return `${label} neordinujeme.`;
    const from = hours.from ? spokenTime(hours.from) : undefined;
    const to = hours.to ? spokenTime(hours.to) : undefined;
    if (!from || !to) return `${label} neordinujeme.`;
    return `${label} ordinujeme od ${from} do ${to}.`;
  });
  const note = config?.officeHoursNote?.trim();
  return ['Ordinačné hodiny sú:', ...lines, ...(note ? [/[.!?]$/.test(note) ? note : `${note}.`] : [])].join(' ');
}
