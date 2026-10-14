import { ElisseaAppointmentType, ElisseaRequestType } from '../config/elissea.config';

export function normalizeElisseaSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseElisseaYesNo(value: string): boolean | undefined {
  const text = normalizeElisseaSpeech(value);
  if (/^(1|ano|hej|som|samozrejme)(\s|$)/.test(text)) return true;
  if (/^(2|nie|nie som|este nie)(\s|$)/.test(text)) return false;
  return undefined;
}

export function parseElisseaMainMenu(value: string): 'appointment' | 'administrative' | 'certificate' | 'other' | undefined {
  const text = normalizeElisseaSpeech(value);
  if (text === '1' || /(objedna|termin|vysetren|kontrol|odber|ockovan|preventiv)/.test(text)) return 'appointment';
  if (text === '2' || /(recept|predpis|pn|prace neschop|vysled)/.test(text)) return 'administrative';
  if (text === '3' || /(tlaciv|potvrden|posudok)/.test(text)) return 'certificate';
  if (text === '4' || /(ine|iny problem|ostatn)/.test(text)) return 'other';
  return undefined;
}

export function parseElisseaAdministrativeType(value: string): Exclude<ElisseaRequestType, 'appointment' | 'certificate' | 'other' | 'new_patient'> | undefined {
  const text = normalizeElisseaSpeech(value);
  if (text === '1' || /(recept|predpis|liek)/.test(text)) return 'prescription';
  if (text === '2' || /(^|\s)pn(\s|$)|prace neschop|praceneschop/.test(text)) return 'sick_leave';
  if (text === '3' || /vysled/.test(text)) return 'results';
  return undefined;
}

export function parseElisseaAppointmentType(value: string): ElisseaAppointmentType | undefined {
  const text = normalizeElisseaSpeech(value);
  if (text === '1' || /(akut|nahle|bolest|chor|tazkost)/.test(text)) return 'acute_exam';
  if (text === '2' || /kontrol/.test(text)) return 'control_exam';
  if (text === '3' || /(odber|krv)/.test(text)) return 'blood_draw';
  if (text === '4' || /ockovan/.test(text)) return 'vaccination';
  if (text === '5' || /preventiv/.test(text)) return 'preventive_exam';
  return undefined;
}

export function extractElisseaBirthYear(value: string): string | undefined {
  return normalizeElisseaSpeech(value).match(/\b(19\d{2}|20[0-2]\d)\b/)?.[1];
}
