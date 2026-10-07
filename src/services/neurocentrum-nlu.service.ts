import { DateTime } from 'luxon';
import { NeurocentrumRequestType } from '../config/neurocentrum.config';

export function normalizeNeurocentrumSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNeurocentrumYesNo(value: string): boolean | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  if (/^(1|ano|hej|samozrejme|som|uz som)(\s|$)/.test(text)) return true;
  if (/^(2|nie|nie som|este nie|prvykrat)(\s|$)/.test(text)) return false;
  return undefined;
}

export function parseNeurocentrumRequestType(value: string): NeurocentrumRequestType | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  if (text === '1' || /(recept|predpis|predpisat|liek|lieky)/.test(text)) return 'prescription';
  if (text === '3' || /(vysled|mri|magnet|ct|emg|eeg|laborator|krv)/.test(text)) return 'results';
  if (text === '2' || /(kontrol|objedna|termin|vysetren)/.test(text)) return 'follow_up';
  return undefined;
}

const prescriptionPackageCountPattern = /\b(?:\d+|jeden|jedno|jednu|dva|dve|tri|styri|pat|sest|sedem|osem|devat|desat)\s*(?:balen(?:ie|ia|i)|krabick(?:a|y|u)|kus(?:y|ov)?)\b/;
const prescriptionDetailStopWords = new Set([
  'a', 'aj', 'chcem', 'dakujem', 'do', 'este', 'iste', 'liek', 'lieky', 'liekov',
  'mi', 'na', 'nazov', 'nazvy', 'neviem', 'pacient', 'pacientka', 'po', 'pocet', 'potrebujem',
  'predpis', 'predpisat', 'prosim', 'recept', 'to', 'ten', 'tento', 'tieto', 'znova',
  'chce', 'chcel', 'chcela', 'dajte',
  'balenie', 'balenia', 'baleni', 'krabicka', 'krabicky', 'krabicku', 'kus', 'kusy', 'kusov',
  'mg', 'miligram', 'miligramov', 'gram', 'gramov', 'tableta', 'tablety', 'tabliet',
  'jeden', 'jedno', 'jednu', 'dva', 'dve', 'tri', 'styri', 'pat', 'sest', 'sedem',
  'osem', 'devat', 'desat',
]);

export function isNeurocentrumPrescriptionDetailComplete(value: string): boolean {
  const text = normalizeNeurocentrumSpeech(value);
  if (!prescriptionPackageCountPattern.test(text)) return false;

  return text
    .split(' ')
    .some(token => /\p{L}/u.test(token) && token.length >= 3 && !prescriptionDetailStopWords.has(token));
}

export function isNeurocentrumUrgent(value: string): boolean {
  const text = normalizeNeurocentrumSpeech(value);
  return /(bezvedom|nedycha|dusim|dusenie|ochrnut|ochrnul|nahla slabost|ovisnuty kutik|porucha reci|nevie rozpravat|mozgova prihoda|mrtvica|silna nahla bolest hlavy|najhorsia bolest hlavy|prebiehajuci zachvat|status epileptic)/.test(text);
}

const monthNumbers: Record<string, number> = {
  januar: 1, januara: 1,
  februar: 2, februara: 2,
  marec: 3, marca: 3,
  april: 4, aprila: 4,
  maj: 5, maja: 5,
  jun: 6, juna: 6,
  jul: 7, jula: 7,
  august: 8, augusta: 8,
  september: 9, septembra: 9,
  oktober: 10, oktobra: 10,
  november: 11, novembra: 11,
  december: 12, decembra: 12,
};

function validDate(day: number, month: number, year: number): string | undefined {
  const date = DateTime.fromObject({ day, month, year }, { zone: 'Europe/Bratislava' });
  if (!date.isValid || date.day !== day || date.month !== month || date.year !== year) return undefined;
  if (year < 1900 || date > DateTime.now()) return undefined;
  return date.toFormat('dd.MM.yyyy');
}

export function normalizeNeurocentrumDateOfBirth(value: string): string | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  const numeric = text.match(/\b(\d{1,2})\s+(\d{1,2})\s+(19\d{2}|20\d{2})\b/);
  if (numeric) return validDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));

  const named = text.match(/\b(\d{1,2})\s+([a-z]+)\s+(19\d{2}|20\d{2})\b/);
  if (!named) return undefined;
  const month = monthNumbers[named[2]];
  return month ? validDate(Number(named[1]), month, Number(named[3])) : undefined;
}
