import { DateTime } from 'luxon';
import { DentbodyIntent } from '../config/dentbody.config';

export function normalizeDentbodySpeech(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDentbodyFinish(value: string): boolean {
  const text = normalizeDentbodySpeech(value);
  if (/^(nie|nie dakujem|dakujem|dakujem dovidenia|(nie )?(dakujem )?(to je vsetko|to bude vsetko|uz nic|nic viac|nic dalsie|dovidenia|staci))$/.test(text)) {
    return true;
  }
  return /^(nie )?(uz )?nepotrebujem (uz )?nic( viac| dalsie)?( dakujem)?$/.test(text)
    || /^(nie )?(uz )?nic( viac| dalsie)? nepotrebujem( dakujem)?$/.test(text)
    || /^(nie )?(uz )?netreba mi (uz )?nic( viac| dalsie)?( dakujem)?$/.test(text);
}

export function isDentbodyContinue(value: string): boolean {
  const text = normalizeDentbodySpeech(value);
  return /^(ano|hej|prosim)(\s|$)/.test(text) && text.split(' ').length <= 2;
}

export function parseDentbodyIntents(value: string): DentbodyIntent[] {
  const text = normalizeDentbodySpeech(value);
  const intents: DentbodyIntent[] = [];
  const add = (intent: DentbodyIntent, pattern: RegExp) => {
    if (pattern.test(text) && !intents.includes(intent)) intents.push(intent);
  };

  const digitMap: Record<string, DentbodyIntent[]> = {
    '1': ['office_hours'],
    '2': ['appointment', 'referral'],
    '3': ['dental_images', 'general_images', 'radiology_report'],
    '4': ['address', 'contact'],
  };
  if (digitMap[text]) return digitMap[text];

  add('retrospective_image', /(spatne|stara|starsia|znova|dodatocne|neskor).*\b(snim|rtg|r[eo]ntgen)|\b(snim|rtg|r[eo]ntgen).*\b(spatne|stara|starsia|znova|dodatocne|neskor)/);
  add('office_hours', /(ordinac|otvarac|otvorene|otvoreni|kedy.*(ordin|otvor)|dokedy|pracovn.*hodin|obedn.*prest|vikend|zajtra)/);
  add('appointment', /(objedna|rezerv|termin|na pockanie|bez objednania|treba sa hlasit)/);
  add('referral', /(ziadank|vymenn|listok od lekar|papier od lekar|odporuc|bez listka|bez papier)/);
  add('address', /(adresa|kde (ste|sidli|vas najdem)|ako sa k vam|fedinov|petrzalk|zdravotn.*stredisk)/);
  add('patients', /(diet|deti|dosp|imobil|vozick|pacientov prijimate|pre koho)/);
  add('payment', /(plat|kart|hotovost|cash|terminal)/);
  add('certificate', /(potvrden|priepust|zamestnavatel|uhrada.*vysetren|doklad)/);
  add('radiology_report', /(popis|radiolog|nale[zž]|vysled|12.*24|dvanast.*dvadsatstyri)/);
  add('dental_images', /(zubn|opan|opg|panoram).*\b(snim|rtg|r[eo]ntgen|fotopapier|email|mail|cede|cd)|\b(snim|rtg|r[eo]ntgen).*\b(zubn|opan|opg|panoram)/);
  add('general_images', /(vseobecn|pluc|hrudnik|kost|koncatin).*\b(snim|rtg|r[eo]ntgen|cede|cd)|\b(snim|rtg|r[eo]ntgen).*\b(vseobecn|pluc|hrudnik|kost|koncatin)/);
  add('pricing', /(cena|cennik|kolko (to|stoji|zaplatim)|poplatok|euro)/);
  add('contact', /(kontakt|web|strank|dentbodyxray|aky.*(email|e mail|mail)|kde.*(email|e mail|mail)|emailov.*adres)/);
  add('medical_advice', /(aky|aku|ake|ktory|ktoru|ktore).*\b(rtg|r[eo]ntgen|snim|vysetren)|diagnoz|je to vhodne|mozem ist na (rtg|r[eo]ntgen)|potrebujem (rtg|r[eo]ntgen)/);

  if (intents.includes('retrospective_image')) {
    return intents.filter(intent => !['dental_images', 'general_images', 'contact', 'medical_advice'].includes(intent));
  }

  const asksAboutDelivery = /(email|mail|poslat|zaslat|dostat|vydat|vyhotov|cd|cede|fotopapier)/.test(text);
  if (intents.includes('medical_advice') && !asksAboutDelivery) {
    return intents.filter(intent => intent !== 'dental_images' && intent !== 'general_images');
  }

  // Generic questions about delivery without a stated modality are answered
  // conservatively with both approved image-delivery rules.
  if (
    intents.length === 0
    && (
      (/(snim|rtg|r[eo]ntgen)/.test(text) && /(email|mail|poslat|dostat|vydat|vyhotov|cd|cede|fotopapier)/.test(text))
      || /(poslat|zaslat|dostat|vydat).*(email|mail|cd|cede|fotopapier)/.test(text)
      || /(cd|cede|fotopapier)/.test(text)
    )
  ) {
    intents.push('dental_images', 'general_images');
  }

  return intents;
}

const weekdayLabels = [
  '',
  'pondelok',
  'utorok',
  'stredu',
  'štvrtok',
  'piatok',
  'sobotu',
  'nedeľu',
];

type Interval = { start: number; end: number; startLabel: string; endLabel: string };

function intervalsForWeekday(weekday: number): Interval[] {
  if (weekday === 1) {
    return [
      { start: 450, end: 750, startLabel: '7:30', endLabel: '12:30' },
      { start: 780, end: 990, startLabel: '13:00', endLabel: '16:30' },
    ];
  }
  if (weekday >= 2 && weekday <= 4) {
    return [
      { start: 450, end: 750, startLabel: '7:30', endLabel: '12:30' },
      { start: 780, end: 900, startLabel: '13:00', endLabel: '15:00' },
    ];
  }
  if (weekday === 5) return [{ start: 450, end: 780, startLabel: '7:30', endLabel: '13:00' }];
  return [];
}

function spokenTime(label: string): string {
  const values: Record<string, string> = {
    '7:30': 'siedmej tridsať',
    '12:30': 'dvanástej tridsať',
    '13:00': 'trinástej',
    '15:00': 'pätnástej',
    '16:30': 'šestnástej tridsať',
  };
  return values[label] || label;
}

function requestedWeekday(text: string): number | undefined {
  const patterns: Array<[number, RegExp]> = [
    [1, /pondel/],
    [2, /utor/],
    [3, /stred/],
    [4, /stvrt/],
    [5, /piat/],
    [6, /sobot/],
    [7, /nedel/],
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0];
}

function scheduleForDay(weekday: number): string {
  if (weekday === 1) return 'V pondelok vyšetrujeme od siedmej tridsať do dvanástej tridsať a od trinástej do šestnástej tridsať.';
  if (weekday >= 2 && weekday <= 4) return `V ${weekdayLabels[weekday]} vyšetrujeme od siedmej tridsať do dvanástej tridsať a od trinástej do pätnástej.`;
  if (weekday === 5) return 'V piatok vyšetrujeme od siedmej tridsať do trinástej bez obednej prestávky.';
  return `V ${weekdayLabels[weekday]} máme zatvorené.`;
}

export function dentbodyOfficeHoursAnswer(
  originalQuestion: string,
  now: DateTime = DateTime.now().setZone('Europe/Bratislava')
): string {
  const text = normalizeDentbodySpeech(originalQuestion);
  const weekday = requestedWeekday(text);
  if (weekday !== undefined) return scheduleForDay(weekday);
  if (/vikend/.test(text)) return 'V sobotu a v nedeľu máme zatvorené.';
  if (/zajtra/.test(text)) return scheduleForDay(now.plus({ days: 1 }).weekday);

  const asksAboutToday = /(dnes|teraz|aktualne|momentalne|dokedy)/.test(text);
  if (!asksAboutToday) {
    return 'Ordinačné hodiny sú v pondelok od siedmej tridsať do dvanástej tridsať a od trinástej do šestnástej tridsať. V utorok, stredu a štvrtok od siedmej tridsať do dvanástej tridsať a od trinástej do pätnástej. V piatok od siedmej tridsať do trinástej.';
  }

  const intervals = intervalsForWeekday(now.weekday);
  if (intervals.length === 0) return `Dnes, v ${weekdayLabels[now.weekday]}, máme zatvorené.`;

  const minute = now.hour * 60 + now.minute;
  const active = intervals.find(interval => minute >= interval.start && minute < interval.end);
  if (active) {
    const next = intervals.find(interval => interval.start > active.end);
    if (next) {
      return `Momentálne vyšetrujeme do ${spokenTime(active.endLabel)}. Po obednej prestávke pokračujeme od ${spokenTime(next.startLabel)} do ${spokenTime(next.endLabel)}.`;
    }
    return `Momentálne vyšetrujeme do ${spokenTime(active.endLabel)}.`;
  }

  const next = intervals.find(interval => minute < interval.start);
  if (next) {
    if (minute >= intervals[0].end) {
      return `Momentálne je obedná prestávka. Znovu vyšetrujeme od ${spokenTime(next.startLabel)} do ${spokenTime(next.endLabel)}.`;
    }
    return `Dnes otvárame o ${spokenTime(next.startLabel)}.`;
  }
  return 'Dnes už máme zatvorené.';
}

const answers: Record<Exclude<DentbodyIntent, 'office_hours'>, string> = {
  appointment: 'Na zubné ani všeobecné RTG vyšetrenie sa neobjednáva. Pacientov vyšetrujeme na počkanie počas ordinačných hodín.',
  address: 'Obe RTG ambulancie sa nachádzajú v Zdravotnom stredisku FEDINOVA na Fedinovej 9 v Bratislave, v Petržalke.',
  referral: 'Prijímame pacientov aj bez žiadanky alebo výmenného lístka.',
  patients: 'Vyšetrujeme deti, dospelých aj imobilných pacientov.',
  payment: 'Za RTG vyšetrenie môžete zaplatiť kartou alebo v hotovosti.',
  dental_images: 'Zubné RTG snímky vyhotovujeme na cédečko, fotopapier alebo ich bezplatne posielame e-mailom pacientovi či lekárovi.',
  general_images: 'Snímky zo všeobecného RTG vyhotovujeme iba na cédečko.',
  radiology_report: 'K všeobecnému RTG vyšetreniu poskytujeme popis snímky od rádiológa najneskôr do dvanástich až dvadsiatich štyroch hodín. Bezplatne ho môžeme poslať e-mailom pacientovi alebo lekárovi.',
  certificate: 'Na žiadosť pacienta bezplatne vystavujeme priepustku alebo potvrdenie o úhrade RTG vyšetrenia pre zahraničného zamestnávateľa.',
  retrospective_image: 'Ak potrebujete snímku poslať spätne, napíšte na e-mail ambulancia bodka er té gé zavináč dentbodyxray bodka es ká. Uveďte meno, priezvisko a rodné číslo pacienta. Tieto údaje mi prosím nehovorte telefonicky.',
  contact: 'Webová stránka je vé vé vé bodka dentbodyxray bodka es ká. E-mail je ambulancia bodka er té gé zavináč dentbodyxray bodka es ká.',
  pricing: 'Presný cenník zatiaľ nemám k dispozícii. Informáciu o cene si prosím overte e-mailom na ambulancia bodka er té gé zavináč dentbodyxray bodka es ká.',
  medical_advice: 'Neviem určiť, ktorý typ RTG vyšetrenia potrebujete. Overte si to prosím u svojho ošetrujúceho lekára.',
};

export function buildDentbodyAnswer(
  intents: DentbodyIntent[],
  originalQuestion: string,
  now?: DateTime
): string {
  const unique = [...new Set(intents)].slice(0, 3);
  return unique
    .map(intent => intent === 'office_hours'
      ? dentbodyOfficeHoursAnswer(originalQuestion, now)
      : answers[intent])
    .join(' ');
}
