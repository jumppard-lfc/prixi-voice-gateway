import { LenerovaRequestType } from '../config/lenerova.config';

export function normalizeLenerovaSpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLenerovaOfficeHoursQuestion(value: string): boolean {
  const text = normalizeLenerovaSpeech(value);
  return /(ordinac|kedy.*ordin|otvoren|otvarac|dokedy|pracovn.*hodin)/.test(text);
}

export type LenerovaInformationTopic =
  | 'office_hours'
  | 'location'
  | 'insurance'
  | 'substitution'
  | 'contact'
  | 'other';

function isLenerovaContactQuestion(text: string): boolean {
  return /(kontakt|email|e mail|mail)/.test(text)
    || /((aky|ake|povedzte|dajte).*(telefon|cislo)|(telefon|cislo).*(ambulanc|ordinac|kontakt)|telefon.*cislo|kam.*volat)/.test(text);
}

export function parseLenerovaInformationTopic(value: string): LenerovaInformationTopic {
  const text = normalizeLenerovaSpeech(value);
  if (isLenerovaOfficeHoursQuestion(text)) return 'office_hours';
  if (/(adres|kde.*(ambul|ordin|pracovisk)|pracovisk|stupav|malack)/.test(text)) return 'location';
  if (/(poistovn|zmluv)/.test(text)) return 'insurance';
  if (/(zastup|dovolenk|nepritomn)/.test(text)) return 'substitution';
  if (isLenerovaContactQuestion(text)) return 'contact';
  return 'other';
}

export function isLenerovaInformationMenuChoice(value: string): boolean {
  const text = normalizeLenerovaSpeech(value);
  return /^(7|sedem|sedmicka|organizacna informacia|organizacne informacie)$/.test(text);
}

export function isLenerovaConversationFinish(value: string): boolean {
  const text = normalizeLenerovaSpeech(value);
  return /^(2|nie|nie dakujem|dakujem|dovidenia|(nie )?(dakujem )?(to je vsetko|to bude vsetko|uz nic|nic viac|staci)( dakujem)?)$/.test(text)
    || /^(nie )?(uz )?(nepotrebujem|netreba mi) (uz )?nic( viac| dalsie)?( dakujem)?$/.test(text);
}

export function isLenerovaConversationContinue(value: string): boolean {
  const text = normalizeLenerovaSpeech(value);
  return /^(1|ano|ano prosim|hej|este nieco|mam este otazku)$/.test(text);
}

export function parseLenerovaRequestType(value: string): LenerovaRequestType | undefined {
  const text = normalizeLenerovaSpeech(value);
  if (/^(1|jeden|jedna|jednotka)$/.test(text)) return 'prescription';
  if (/^(2|dva|dvojka)$/.test(text)) return 'appointment';
  if (/^(3|tri|trojka)$/.test(text)) return 'appointment_change';
  if (/^(4|styri|stvorka)$/.test(text)) return 'worsening';
  if (/^(5|pat|patka)$/.test(text)) return 'administration';
  if (/^(6|sest|sestka)$/.test(text)) return 'new_patient';
  if (/^(7|sedem|sedmicka)$/.test(text)) return 'information';

  if (/(zmenit|zrusit|prelozit|preobjednat|nemozem prist).*(termin|kontrol)|termin.*(zmenit|zrusit|prelozit)/.test(text)) {
    return 'appointment_change';
  }
  if (/(zhors|vedlajs|neziaduc|problem.*liek|liek.*problem|je mi horsie)/.test(text)) return 'worsening';
  if (/(novy pacient|nova pacientka|prve vysetren|vstupne vysetren|prihlasit)/.test(text)) return 'new_patient';
  if (/(lekarsk.*sprav|potvrden|vysled|nalez|dokument|administrativ|peenka|pn)/.test(text)) return 'administration';
  if (
    /(ordinac|kedy.*ordin|otvoren|adres|kde.*(ambul|ordin|pracovisk)|pracovisk|poistovn|zmluv|zastup|dovolenk|nepritomn|stupav|malack)/.test(text)
    || isLenerovaContactQuestion(text)
  ) return 'information';
  const mentionsExplicitAppointment = /(termin|kontrol|vysetren|navstev)/.test(text);
  if (mentionsExplicitAppointment && /(objedna|chcem|potrebujem|prosim)/.test(text)) return 'appointment';
  if (
    /(recept|predpis|e recept|dochadz.*liek|dosl.*liek|min.*sa.*liek|pravideln.*liek)/.test(text)
    || /\b(objedna|chcem|potrebujem|prosim|vystavit).*\b(liek|tablet|medikament)/.test(text)
  ) return 'prescription';
  if (/(objedna|termin|kontrol)/.test(text)) return 'appointment';
  return undefined;
}
