import { NimalaAppointmentType, NimalaRequestType } from '../config/nimala.config';
import { PrixiCalendarSlot } from './prixi-calendar.service';

export function normalizeNimalaSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type NimalaDepartment = 'urology' | 'aesthetics' | 'ultrasound' | 'proctology' | 'dermatology';

export function parseNimalaDepartment(value: string): NimalaDepartment | undefined {
  const text = normalizeNimalaSpeech(value);
  if (/^(1|jeden|jedna|jednotka)$/.test(text) || /(urolog|anovcin|prostat|ufm|uroflow)/.test(text)) return 'urology';
  if (/^(2|dva|dvojka)$/.test(text) || /estet/.test(text)) return 'aesthetics';
  if (/^(3|tri|trojka)$/.test(text) || /(sonograf|ultrazvuk|sono)/.test(text)) return 'ultrasound';
  if (/^(4|styri|stvorka)$/.test(text) || /proktolog/.test(text)) return 'proctology';
  if (/^(5|pat|patka)$/.test(text) || /dermatolog/.test(text)) return 'dermatology';
  return undefined;
}

export function parseNimalaMainMenu(value: string): NimalaRequestType | undefined {
  const text = normalizeNimalaSpeech(value);
  // Specific administrative intents must win over generic words such as
  // "vyšetrenie" (for example in "výsledky vyšetrenia").
  if (/^(0|nula)$/.test(text) || /(clovek|recepci|spojit|personal|sestra)/.test(text)) return 'human';
  if (/^(2|dva|dvojka)$/.test(text) || /(recept|predpis|liek)/.test(text)) return 'prescription';
  if (/^(3|tri|trojka)$/.test(text) || /vysled/.test(text)) return 'results';
  if (/^(1|jeden|jedna|jednotka)$/.test(text) || /(objedna|rezerv|termin|vysetren|prehliad|kontrol|konzult|ufm)/.test(text)) return 'appointment';
  return undefined;
}

export function parseNimalaAppointmentType(value: string): NimalaAppointmentType | undefined {
  const text = normalizeNimalaSpeech(value);
  if (/^(1|jeden|jedna|jednotka)$/.test(text) || /(vip)/.test(text)) return 'vip_urology';
  if (/^(2|dva|dvojka)$/.test(text) || /preventiv/.test(text)) return 'preventive_exam';
  if (/^(3|tri|trojka)$/.test(text) || (/konzult/.test(text) && !/(para|prostat|operaci)/.test(text))) return 'consultation';
  if (/^(4|styri|stvorka)$/.test(text) || /(kontrol.*operaci|pooperac)/.test(text)) return 'postoperative_control';
  if (/^(5|pat|patka)$/.test(text) || /(vodn.*par|para|rezum|prostat.*operaci)/.test(text)) return 'steam_prostate_consultation';
  if (/^(6|sest|sestka)$/.test(text) || /(ufm|uroflow)/.test(text)) return 'ufm';
  return undefined;
}

export function parseNimalaYesNo(value: string): boolean | undefined {
  const text = normalizeNimalaSpeech(value);
  if (/^(1|ano|anon|annon|hej|suhlasim|potvrdzujem|dobre|spravne|plati|moze byt)(\s|$)/.test(text)) return true;
  if (/^(2|nie|nesuhlasim|iny|ine|zmenit|chcem iny)(\s|$)/.test(text)) return false;
  return undefined;
}

export function parseNimalaSlotChoice(value: string, slots: PrixiCalendarSlot[]): number | undefined {
  const text = normalizeNimalaSpeech(value);
  const numeric = text.match(/(?:^|\s)([1-3])(?:\s|$)/)?.[1];
  if (numeric && slots[Number(numeric) - 1]) return Number(numeric) - 1;
  if (/\b(jeden|jedna|jednotka|prv\p{L}*)\b/u.test(text) && slots[0]) return 0;
  if (/\b(dva|dvojka|druh\p{L}*)\b/u.test(text) && slots[1]) return 1;
  if (/\b(tri|trojka|tret\p{L}*)\b/u.test(text) && slots[2]) return 2;
  return undefined;
}

export function parseNimalaName(value: string): { firstName: string; lastName: string; fullName: string } | undefined {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length < 2 || words.some(word => !/\p{L}/u.test(word))) return undefined;
  return { firstName: words[0], lastName: words.slice(1).join(' '), fullName: words.join(' ') };
}

export function parseNimalaBirthYear(value: string): string | undefined {
  return normalizeNimalaSpeech(value).match(/\b(19\d{2}|20[0-2]\d)\b/)?.[1];
}

