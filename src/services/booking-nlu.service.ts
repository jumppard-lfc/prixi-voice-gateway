import { BookingServiceCode, DatePreference } from '../types';

const normalize = (value: string) => value.toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export function parseService(value: string): BookingServiceCode | undefined {
  const text = normalize(value);
  if (/(prvykrat|prva navsteva|vstupn)/.test(text)) return 'initial_exam';
  if (/(kontrol)/.test(text)) return 'follow_up';
  if (/(akut|zap[a-z]*l|cudzie teleso|nieco.*oku)/.test(text)) return 'acute_exam';
  if (/(vodic|zbroj|vysk|perimeter)/.test(text)) return 'certificate_exam';
  if (/(estet)/.test(text)) return 'aesthetic_medicine';
  return undefined;
}

export function parseDatePreference(value: string): DatePreference | undefined {
  const text = normalize(value);
  if (/(najbliz|co najskor|cim skor|prvy volny)/.test(text)) return { kind: 'earliest' };
  const timeOfDay = /(poobede|popoludni|odpoludnia)/.test(text) ? 'afternoon' : /(dopoludnia|rano)/.test(text) ? 'morning' : undefined;
  // Relative calendar language is deliberately confirmed in the next prompt. We do not guess an exact date.
  if (/(buduci tyzden|tento tyzden|pondelok|utorok|streda|stvrtok|piatok|sobota|nedela)/.test(text)) {
    return { kind: 'next_available', timeOfDay };
  }
  return timeOfDay ? { kind: 'next_available', timeOfDay } : undefined;
}

export function parseYesNo(value: string): boolean | undefined {
  const text = normalize(value);
  if (/^(ano|ano prosim|suhlasim|potvrdzujem|jasne|hej|1)$/.test(text)) return true;
  if (/^(nie|nesuhlasim|nechcem|2)$/.test(text)) return false;
  return undefined;
}

export function parseSlotChoice(value: string, count: number): number | undefined {
  const text = normalize(value);
  const match = text.match(/\b([1-3])\b/);
  if (match) return Number(match[1]) - 1;
  if (/(prv[ay]|utorok)/.test(text)) return 0;
  if (/(druh[ay]|streda)/.test(text)) return 1;
  if (/(tret[ia]|piatok)/.test(text)) return 2;
  return undefined;
}

export function parseName(value: string): { firstName: string; lastName: string } | undefined {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return undefined;
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

export function parseEmail(value: string): string | undefined {
  const compact = value.toLocaleLowerCase('sk-SK')
    .replace(/zavinac|zavináč/g, '@').replace(/bodka/g, '.').replace(/\s+/g, '');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compact) ? compact : undefined;
}
