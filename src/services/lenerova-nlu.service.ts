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
  if (/(ordinac|kedy.*ordin|otvoren|adresa|pracovisko|poistovn|zastupovan|stupava|malacky)/.test(text)) return 'information';
  if (/(recept|predpis|dochadz.*liek|potrebujem.*liek|pravideln.*liek)/.test(text)) return 'prescription';
  if (/(objedna|termin|kontrol)/.test(text)) return 'appointment';
  return undefined;
}
