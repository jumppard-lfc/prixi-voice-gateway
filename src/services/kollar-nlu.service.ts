import { KollarRequestType } from '../config/kollar.config';

export function normalizeKollarSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseKollarRequestType(value: string): KollarRequestType | undefined {
  const text = normalizeKollarSpeech(value);

  if (text === '1' || /(akut|urgent|siln.*bolest|krvac|nahly problem)/.test(text)) return 'acute_problem';
  if (text === '2' || /(recept|predpis|predpisat|liek|lieky)/.test(text)) return 'prescription';
  if (text === '3' || /(vysled|laborator|cytolog|ster|nalez)/.test(text)) return 'results';
  if (text === '4' || /(objedna|termin|kontrol|prehliadk)/.test(text)) return 'appointment';
  if (text === '5' || /(nov.*pacient|stat.*pacient|chcem byt.*pacient|chcela by som byt.*pacient|registrov|registrac|prestup|preniest kartu|prenos karty)/.test(text)) return 'new_patient';
  if (text === '6' || /(ordinac|otvarac|kedy ordin|pracovn.*hodin)/.test(text)) return 'office_hours';
  if (text === '7' || /(clovek|sestr|operator|odkaz|ine|iny problem|neviem zaradit)/.test(text)) return 'human_message';

  return undefined;
}

export function extractKollarBirthYear(value: string): string | undefined {
  const year = normalizeKollarSpeech(value).match(/\b(19\d{2}|20[0-2]\d)\b/)?.[1];
  if (!year || Number(year) > new Date().getFullYear()) return undefined;
  return year;
}

export function parseKollarIdentity(value: string): { patientName?: string; birthYear?: string } {
  const birthYear = extractKollarBirthYear(value);
  let patientName = value;

  if (birthYear) patientName = patientName.replace(birthYear, ' ');
  patientName = patientName
    .replace(/\b(?:volám sa|volam sa|moje meno je|meno je|rok narodenia|narodila som sa|narodil som sa|narodená|narodena|narodený|narodeny|v roku)\b/giu, ' ')
    .replace(/[\d,.;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    patientName: patientName || undefined,
    birthYear,
  };
}
