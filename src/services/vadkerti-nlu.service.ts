import { VadkertiLanguage, VadkertiRequestType } from '../config/vadkerti.config';

export function normalizeVadkertiSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVadkertiLanguage(value: string): VadkertiLanguage | undefined {
  const text = normalizeVadkertiSpeech(value);
  if (/^(1|slovencina|slovensky|po slovensky|slovak)/.test(text)) return 'sk';
  if (/^(2|madarcina|madarsky|po madarsky|magyar|magyarul)/.test(text)) return 'hu';
  return undefined;
}

export function parseVadkertiYesNo(value: string): boolean | undefined {
  const text = normalizeVadkertiSpeech(value);
  if (/^(1|ano|hej|samozrejme|igen|persze)(\s|$)/.test(text)) return true;
  if (/^(2|nie|nem)(\s|$)/.test(text)) return false;
  return undefined;
}

export function isVadkertiUrgent(value: string): boolean {
  const text = normalizeVadkertiSpeech(value);
  return /(bezvedom|nedycha|dusim|dusenie|ochrnut|ochrnul|nahla slabost|ovisnuty kutik|porucha reci|nevie rozpravat|mozgov[a-z]* prihoda|mrtvica|silna nahla bolest hlavy|najhorsia bolest hlavy|prebiehajuci zachvat|status epileptic|eszmeletlen|nem lelegzik|fullad|hirtelen lebenul|arc lebiggyed|beszedzavar|agyverzes|stroke|szelutes|nagyon eros hirtelen fejfajas|folyamatos roham)/.test(text);
}

export function parseVadkertiIntent(value: string): VadkertiRequestType | 'appointment_history' | undefined {
  const text = normalizeVadkertiSpeech(value);
  const digitMap: Record<string, VadkertiRequestType | 'appointment_history'> = {
    '1': 'appointment_history',
    '2': 'follow_up_with_results',
    '3': 'procedure_or_therapy',
    '4': 'prescription',
    '5': 'medical_report',
    '6': 'appointment_change_or_cancellation',
    '7': 'other',
  };
  if (digitMap[text]) return digitMap[text];

  // More specific intents must win over a generic request for an appointment.
  if (/(predlzen|vystaven|potvrden|posud|socialn|imobil|orvosi jelent|igazolas|szakvelemeny)/.test(text)) return 'medical_report';
  if (/(ct|mri|emg|eeg|magnetick|vysled|eredmeny|lelet|kontrola s vysled)/.test(text)) return 'follow_up_with_results';
  if (/(usg|ultrazvuk|karotid|klb|obstrek|injekci|kinesio|tape|terapi|kezeles)/.test(text)) return 'procedure_or_therapy';
  if (/(recept|predpis|predpisat|liek|gyogyszer|veny)/.test(text)) return 'prescription';
  if (/(zrus|zmena terminu|preloz|nemozem prist|lemond|idopont.*modosit|masik idopont)/.test(text)) return 'appointment_change_or_cancellation';

  if (/(nikdy.*neurolog|prvykrat.*neurolog|meg soha.*neurolog)/.test(text)) return 'new_patient_no_neurologist';
  if (/(iny neurolog|ineho neurologa|inemu neurolog|nemocnic|mas neurolog|korabban.*neurolog)/.test(text)) return 'new_to_clinic_seen_neurologist';
  if (/(u vas|tejto ambulanc|vadkerti.*ambulanc|itt.*rendelo|ebben.*rendelo)/.test(text) && /(kontrol|vysetren|vizsgalat)/.test(text)) return 'existing_patient_follow_up';
  if (/(termin|objedna|vysetren|kontrol|idopont|vizsgalat|kontroll)/.test(text)) return 'appointment_history';
  return undefined;
}

export function parseAppointmentAction(value: string): 'change' | 'cancel' | undefined {
  const text = normalizeVadkertiSpeech(value);
  if (/^(1|zmen|preloz|modosit|masik)/.test(text)) return 'change';
  if (/^(2|zrus|lemond)/.test(text)) return 'cancel';
  return undefined;
}

export function extractBirthYear(value: string): string | undefined {
  const match = normalizeVadkertiSpeech(value).match(/\b(19\d{2}|20[0-2]\d)\b/);
  return match?.[1];
}

export function isSocialPurposeReport(value: string): boolean {
  return /(social|posud|invalid|opatrov|szocial|szakert)/.test(normalizeVadkertiSpeech(value));
}
