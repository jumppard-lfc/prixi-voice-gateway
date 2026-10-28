import { MalakovaAppointmentType, MalakovaRequestType } from '../config/malakova.config';

export function normalizeMalakovaSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMalakovaMainMenu(value: string): MalakovaRequestType | undefined {
  const text = normalizeMalakovaSpeech(value);
  if (text === '1' || /(objedna|termin|vysetren)/.test(text)) return 'appointment';
  if (text === '2' || /(recept|predpis|liek)/.test(text)) return 'prescription';
  if (text === '3' || /(spojit|ambulanci|telefon|kontakt|sestra|lekarka)/.test(text)) return 'contact';
  return undefined;
}

export function parseMalakovaAppointmentType(value: string): MalakovaAppointmentType | undefined {
  const text = normalizeMalakovaSpeech(value);
  if (text === '1' || /(zdravotn.*tazkost|akut|chor|bolest|problem)/.test(text)) return 'health_problem';
  if (text === '2' || /potvrden/.test(text)) return 'certificate';
  if (text === '3' || /predoperac/.test(text)) return 'preoperative_exam';
  if (text === '4' || /preventiv/.test(text)) return 'preventive_exam';
  if (text === '5' || /(iny|ine|ostatn)/.test(text)) return 'other';
  return undefined;
}
