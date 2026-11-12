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
  if (text === '1' || /(urolog|anovcin|prostat|ufm|uroflow)/.test(text)) return 'urology';
  if (text === '2' || /estet/.test(text)) return 'aesthetics';
  if (text === '3' || /(sonograf|ultrazvuk|sono)/.test(text)) return 'ultrasound';
  if (text === '4' || /proktolog/.test(text)) return 'proctology';
  if (text === '5' || /dermatolog/.test(text)) return 'dermatology';
  return undefined;
}

export function parseNimalaMainMenu(value: string): NimalaRequestType | undefined {
  const text = normalizeNimalaSpeech(value);
  if (text === '1' || /(objedna|termin|vysetren|kontrol|konzult|ufm)/.test(text)) return 'appointment';
  if (text === '2' || /(recept|predpis|liek)/.test(text)) return 'prescription';
  if (text === '3' || /vysled/.test(text)) return 'results';
  if (text === '0' || /(clovek|recepci|spojit|personal|sestra)/.test(text)) return 'human';
  return undefined;
}

export function parseNimalaAppointmentType(value: string): NimalaAppointmentType | undefined {
  const text = normalizeNimalaSpeech(value);
  if (text === '1' || /(vip)/.test(text)) return 'vip_urology';
  if (text === '2' || /preventiv/.test(text)) return 'preventive_exam';
  if (text === '3' || (/konzult/.test(text) && !/(para|prostat|operaci)/.test(text))) return 'consultation';
  if (text === '4' || /(kontrol.*operaci|pooperac)/.test(text)) return 'postoperative_control';
  if (text === '5' || /(vodn.*par|para|rezum|prostat.*operaci)/.test(text)) return 'steam_prostate_consultation';
  if (text === '6' || /(ufm|uroflow)/.test(text)) return 'ufm';
  return undefined;
}

export function parseNimalaYesNo(value: string): boolean | undefined {
  const text = normalizeNimalaSpeech(value);
  if (/^(1|ano|hej|suhlasim|potvrdzujem|dobre)(\s|$)/.test(text)) return true;
  if (/^(2|nie|nesuhlasim|iny|ine)(\s|$)/.test(text)) return false;
  return undefined;
}

export function parseNimalaSlotChoice(value: string, slots: PrixiCalendarSlot[]): number | undefined {
  const text = normalizeNimalaSpeech(value);
  const numeric = text.match(/(?:^|\s)([1-3])(?:\s|$)/)?.[1];
  if (numeric && slots[Number(numeric) - 1]) return Number(numeric) - 1;
  if (/prv/.test(text) && slots[0]) return 0;
  if (/druh/.test(text) && slots[1]) return 1;
  if (/tret/.test(text) && slots[2]) return 2;
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

