import { DateTime } from 'luxon';
import { KutakovaHealthInsurer, KutakovaLanguage } from '../config/kutakova.config';
import { normalizeNeurocentrumDateOfBirth, normalizeNeurocentrumSpeech } from './neurocentrum-nlu.service';

export function parseKutakovaLanguage(value: string): KutakovaLanguage | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  if (/^(1|slovencina|slovensky|po slovensky|slovak)(\s|$)/.test(text)) return 'sk';
  if (/^(2|anglictina|anglicky|po anglicky|english)(\s|$)/.test(text)) return 'en';
  return undefined;
}

export function parseKutakovaYesNo(value: string): boolean | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  if (/^(1|ano|hej|samozrejme|yes|yeah|correct)(\s|$)/.test(text)) return true;
  if (/^(2|nie|no|nope|incorrect)(\s|$)/.test(text)) return false;
  return undefined;
}

export function parseKutakovaHealthInsurer(value: string): KutakovaHealthInsurer | undefined {
  const text = normalizeNeurocentrumSpeech(value);
  if (text === '1' || /vseobecn|vszp|general health|state health/.test(text)) return 'Všeobecná zdravotná poisťovňa';
  if (text === '2' || /dovera/.test(text)) return 'Dôvera';
  if (text === '3' || /union/.test(text)) return 'Union';
  if (text === '4' || /ina|ine|neviem|neuved|other|not sure|do not know/.test(text)) return 'Iná alebo neuvedená';
  return undefined;
}

const englishMonths: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function validEnglishDate(day: number, month: number, year: number): string | undefined {
  const date = DateTime.fromObject({ day, month, year }, { zone: 'Europe/Bratislava' });
  if (!date.isValid || date.day !== day || date.month !== month || date.year !== year) return undefined;
  if (year < 1900 || date > DateTime.now()) return undefined;
  return date.toFormat('dd.MM.yyyy');
}

export function normalizeKutakovaDateOfBirth(value: string, language: KutakovaLanguage): string | undefined {
  if (language === 'sk') return normalizeNeurocentrumDateOfBirth(value);
  const text = normalizeNeurocentrumSpeech(value);
  const numeric = text.match(/\b(\d{1,2})\s+(\d{1,2})\s+(19\d{2}|20\d{2})\b/);
  if (numeric) return validEnglishDate(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));

  const monthFirst = text.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(19\d{2}|20\d{2})\b/);
  if (monthFirst) {
    const month = englishMonths[monthFirst[1]];
    return month ? validEnglishDate(Number(monthFirst[2]), month, Number(monthFirst[3])) : undefined;
  }

  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(19\d{2}|20\d{2})\b/);
  if (!dayFirst) return undefined;
  const month = englishMonths[dayFirst[2]];
  return month ? validEnglishDate(Number(dayFirst[1]), month, Number(dayFirst[3])) : undefined;
}

export function isKutakovaUrgent(value: string): boolean {
  const text = normalizeNeurocentrumSpeech(value);
  return /(bezvedom|nedycha|dusim|dusenie|ochrnut|nahla slabost|porucha reci|mozgova prihoda|mrtvica|zachvat|unconscious|not breathing|cannot breathe|choking|stroke|seizure|sudden weakness|chest pain)/.test(text);
}
