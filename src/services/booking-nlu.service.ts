import { BookingServiceCode, DatePreference, OfferedSlot } from '../types';

const normalize = (value: string) => value.toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export function parseService(value: string): BookingServiceCode | undefined {
  const text = normalize(value);
  if (text === '1') return 'initial_exam';
  if (text === '2') return 'follow_up';
  if (text === '3') return 'acute_exam';
  if (text === '4') return 'certificate_exam';
  if (text === '5') return 'aesthetic_medicine';
  if (/(prvykrat|prva navsteva|vstupn)/.test(text)) return 'initial_exam';
  if (/(kontrol)/.test(text)) return 'follow_up';
  if (/(akut|zap[a-z]*l|cudzie teleso|nieco.*oku)/.test(text)) return 'acute_exam';
  if (/(vodic|zbroj|vysk|perimeter)/.test(text)) return 'certificate_exam';
  if (/(estet)/.test(text)) return 'aesthetic_medicine';
  return undefined;
}

export function parseDatePreference(value: string): DatePreference | undefined {
  const text = normalize(value);
  if (text === '1') return { kind: 'earliest' };
  if (text === '2') return { kind: 'next_available', timeOfDay: 'morning' };
  if (text === '3') return { kind: 'next_available', timeOfDay: 'afternoon' };
  if (/(najbliz|co najskor|cim skor|prvy volny)/.test(text)) return { kind: 'earliest' };
  const timeOfDay = /(poobede|popoludni|odpoludnia)/.test(text)
    ? 'afternoon'
    : /(dopoludnia|dopoludnie|doobeda|doobedie|doobedia|rano)/.test(text)
      ? 'morning'
      : undefined;
  // Relative calendar language is deliberately confirmed in the next prompt. We do not guess an exact date.
  if (/(buduci tyzden|tento tyzden|pondelok|utorok|streda|stvrtok|piatok|sobota|nedela)/.test(text)) {
    return { kind: 'next_available', timeOfDay };
  }
  return timeOfDay ? { kind: 'next_available', timeOfDay } : undefined;
}

export function parseYesNo(value: string): boolean | undefined {
  // Speech recognition often adds punctuation or a polite trailing word.
  // Treat those as the same unambiguous short confirmation.
  const text = normalize(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/^(nie|nesuhlasim|nechcem|nie dakujem|2)(\s|$)/.test(text)) return false;
  if (/^(ano|ano prosim|suhlasim|potvrdzujem|jasne|hej|1)(\s|$)/.test(text)) return true;
  return undefined;
}

const weekdayMatchers: Array<{ day: number; pattern: RegExp }> = [
  { day: 1, pattern: /pondel/ },
  { day: 2, pattern: /utor/ },
  { day: 3, pattern: /stred/ },
  { day: 4, pattern: /stvrt/ },
  { day: 5, pattern: /piatok/ },
  { day: 6, pattern: /sobot/ },
  { day: 0, pattern: /nedel/ },
];

const weekdayNumbers: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export function parseSlotChoice(value: string, slots: OfferedSlot[]): number | undefined {
  const text = normalize(value);
  const match = text.match(/\b([1-3])\b/);
  if (match && Number(match[1]) <= slots.length) return Number(match[1]) - 1;
  if (/prv[ay]/.test(text) && slots[0]) return 0;
  if (/druh[ay]/.test(text) && slots[1]) return 1;
  if (/tret[ia]/.test(text) && slots[2]) return 2;

  const requestedWeekday = weekdayMatchers.find(({ pattern }) => pattern.test(text))?.day;
  if (requestedWeekday === undefined) return undefined;

  // Match the spoken weekday to the actual dates offered in this call; do not
  // assume that the first, second, and third options are fixed weekdays.
  const matchingIndexes = slots
    .map((slot, index) => {
      const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Europe/Bratislava' }).format(new Date(slot.startAt));
      return weekdayNumbers[weekday] === requestedWeekday ? index : -1;
    })
    .filter((index) => index >= 0);
  if (matchingIndexes.length === 1) return matchingIndexes[0];
  return undefined;
}

export function parseName(value: string): { firstName: string; lastName: string } | undefined {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return undefined;
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}
