import { ClinicConfig } from '../types';
import { parseLenerovaInformationTopic } from './lenerova-nlu.service';
import { buildLenerovaOfficeHoursAnswer } from './lenerova-office-hours.service';

const unverifiedAnswers = {
  location: 'Presnú adresu pracoviska zatiaľ nemám spoľahlivo potvrdenú. Overte si ju, prosím, v pozvánke na vyšetrenie alebo vo verejných kontaktných údajoch ambulancie.',
  insurance: 'Informáciu o zmluvných zdravotných poisťovniach zatiaľ nemám spoľahlivo potvrdenú. Overte si ju, prosím, priamo vo svojej zdravotnej poisťovni.',
  substitution: 'Informáciu o aktuálnom zastupovaní zatiaľ nemám spoľahlivo potvrdenú. Ak je pani doktorka neprítomná, postupujte, prosím, podľa aktuálneho oznamu ambulancie.',
  contact: 'Ďalšie kontaktné údaje ambulancie zatiaľ nemám spoľahlivo potvrdené.',
  other: 'Túto organizačnú informáciu zatiaľ nemám spoľahlivo potvrdenú a nechcem vám povedať nesprávny údaj.',
} as const;

export function buildLenerovaInformationAnswer(config: ClinicConfig, question: string): string {
  const topic = parseLenerovaInformationTopic(question);
  if (topic === 'office_hours') return buildLenerovaOfficeHoursAnswer(config, question);
  return unverifiedAnswers[topic];
}
