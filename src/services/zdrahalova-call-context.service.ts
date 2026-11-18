import { DateTime } from 'luxon';
import { ClinicConfig, VoiceAssistantWorkingHours } from '../types';

export const ZDRAHALOVA_FALLBACK_WORKING_HOURS: VoiceAssistantWorkingHours = {
  monday: { enabled: true, from: '07:00', to: '15:00' },
  tuesday: { enabled: true, from: '07:00', to: '15:00' },
  wednesday: { enabled: true, from: '07:00', to: '15:00' },
  thursday: { enabled: true, from: '10:00', to: '17:00' },
  friday: { enabled: true, from: '07:00', to: '13:00' },
  saturday: { enabled: false, from: null, to: null },
  sunday: { enabled: false, from: null, to: null },
};

export const ZDRAHALOVA_AFTER_HOURS_MESSAGE = 'Dobrý deň, dovolali ste sa do ambulancie doktorky Zdráhalovej. Ambulancia momentálne neordinuje. Informácie o ordinačných hodinách nájdete na webovej stránke www.mudrzdrahalova.sk. Ďakujeme a dovidenia.';

export type ZdrahalovaRequestCategory =
  | 'prescription'
  | 'consultation'
  | 'preventive_reschedule'
  | 'preoperative_or_control_blood_draw';

const CATEGORY_LABELS: Record<ZdrahalovaRequestCategory, string> = {
  prescription: 'predpis / recept',
  consultation: 'konzultácia',
  preventive_reschedule: 'preobjednanie preventívnej prehliadky',
  preoperative_or_control_blood_draw: 'predoperačné vyšetrenie / kontrolné odbery',
};

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

function minutes(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function hasCompleteWorkingHours(value: VoiceAssistantWorkingHours | undefined): boolean {
  if (!value) return false;
  return DAY_NAMES.every(day => {
    const hours = value[day];
    if (!hours) return false;
    if (!hours.enabled) return true;
    const from = minutes(hours.from);
    const to = minutes(hours.to);
    return from !== undefined && to !== undefined && from < to;
  });
}

export function isZdrahalovaAcceptingRequests(
  config: ClinicConfig | undefined,
  now: DateTime = DateTime.now()
): boolean {
  if (config?.enabled === false || config?.voiceBotEnabled === false) return false;
  if (
    config?.availability?.status === 'vacation'
    || config?.availability?.status === 'outside_hours'
    || config?.availability?.status === 'disabled'
  ) return false;

  const timezone = config?.timezone || 'Europe/Bratislava';
  const localNow = now.setZone(timezone);
  if (!localNow.isValid) return false;

  const schedule = hasCompleteWorkingHours(config?.workingHours)
    ? config!.workingHours!
    : ZDRAHALOVA_FALLBACK_WORKING_HOURS;
  const hours = schedule[DAY_NAMES[localNow.weekday - 1]];
  if (!hours?.enabled) return false;

  const from = minutes(hours.from);
  const to = minutes(hours.to);
  if (from === undefined || to === undefined) return false;
  const current = localNow.hour * 60 + localNow.minute;
  return current >= from && current < to;
}

export function buildZdrahalovaClosedMessage(config?: ClinicConfig): string {
  const configured = config?.availability?.message?.trim()
    || config?.messages?.afterHours?.trim()
    || config?.messages?.vacation?.trim();
  if (!configured) return ZDRAHALOVA_AFTER_HOURS_MESSAGE;

  const base = configured.replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  const website = /mudrzdrahalova\.sk|webovej str[aá]nke|na internete/i.test(base)
    ? ''
    : ' Informácie o ordinačných hodinách nájdete na webovej stránke www.mudrzdrahalova.sk.';
  return `${base}.${website} Ďakujeme a dovidenia.`.replace(/\.\s+\./g, '.');
}

export function classifyZdrahalovaRequest(transcript: string): ZdrahalovaRequestCategory {
  const normalized = transcript
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/predoperac|pred operac|kontroln\w*\s+odber|odber\w*\s+(krv|kontrol)/.test(normalized)) {
    return 'preoperative_or_control_blood_draw';
  }
  if (/preventiv/.test(normalized) && /(preobjed|objed|termin|presun|zmen|nemoz|neprid)/.test(normalized)) {
    return 'preventive_reschedule';
  }
  if (/recept|predpis|predpisat|liek|lieky|medikament/.test(normalized)) {
    return 'prescription';
  }
  return 'consultation';
}

export function formatZdrahalovaProblemTranscript(transcript: string): string {
  const category = classifyZdrahalovaRequest(transcript);
  return [
    '[Voice-bot pediatrická ambulancia MUDr. Zdráhalovej]',
    `Kategória: ${CATEGORY_LABELS[category]}`,
    `Požiadavka: ${transcript.trim() || 'neuvedená'}`,
  ].join('\n');
}
