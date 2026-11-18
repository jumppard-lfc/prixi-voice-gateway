import { StefancikRequestType } from '../config/stefancik.config';

export function normalizeStefancikSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseStefancikRequestType(value: string): StefancikRequestType | undefined {
  const text = normalizeStefancikSpeech(value);
  if (/^(1|jeden|jedna|jednotka)$/.test(text) || /(objedna|termin|rezerv|ecakar)/.test(text)) return 'appointment';
  if (/^(2|dva|dvojka)$/.test(text) || /(vysled|nale[zž]|laborator|krv)/.test(text)) return 'results';
  if (/^(3|tri|trojka)$/.test(text) || /(recept|predpis|liek|medikament)/.test(text)) return 'prescription';
  if (/^(4|styri|stvorka)$/.test(text) || /(ordinac|otvoren|kedy.*ordin|pracovn.*hodin)/.test(text)) return 'office_hours';
  return undefined;
}
