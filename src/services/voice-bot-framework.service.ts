export const BOOKING_PROVIDERS = ['prixi', 'bookio', 'calendly', 'custom'] as const;

export type BookingProviderKind = typeof BOOKING_PROVIDERS[number];

export interface VoiceBotServiceDefinition {
  id: string;
  label: string;
  durationMinutes?: number;
  providerServiceId?: string;
  voiceAliases: string[];
}

export interface ConversationPolicy {
  confirmService: boolean;
  confirmDatePreference: boolean;
  confirmSlot: boolean;
  confirmName: boolean;
  requireTerms: boolean;
  sendConfirmationSms: boolean;
  useDtmfFallback: boolean;
  playPromptTone: boolean;
}

export interface VoiceBotRouting {
  /**
   * Dedicated Twilio numbers assigned to this bot. An empty list intentionally
   * means that the bot is reachable only through its explicit dynamic webhook.
   */
  inboundTwilioNumbers: string[];
}

export interface VoiceBotConfig {
  version: 1;
  id: string;
  clinic: {
    displayName: string;
    specialty: string;
    phoneNumber?: string;
    locale: 'sk-SK';
    timezone: string;
  };
  provider: {
    kind: BookingProviderKind;
    mode: 'demo_mock' | 'live';
    connectionId?: string;
  };
  services: VoiceBotServiceDefinition[];
  routing?: VoiceBotRouting;
  conversation: ConversationPolicy;
  copy: {
    introduction?: string;
    closing?: string;
  };
}

export interface VoiceBotConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function normalizeTwilioNumber(value: string): string {
  return value.replace(/[\s()-]/g, '');
}

export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('sk-SK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function buildIntroduction(config: VoiceBotConfig): string {
  if (config.copy.introduction?.trim()) return config.copy.introduction.trim();
  return `Dobrý deň, som virtuálna asistentka ${config.clinic.displayName}. Rada vám pomôžem s objednaním. Spoločne vyberieme typ návštevy, vhodný termín a potom vaše meno. Kedykoľvek môžete odpovedať hlasom alebo použiť tlačidlá na telefóne.`;
}

export function buildFlowSummary(config: VoiceBotConfig): string[] {
  const steps = [
    'Príjemný transparentný úvod a vysvetlenie priebehu hovoru',
    'Výber služby',
    'Preferencia termínu',
    'Výber konkrétneho voľného termínu od booking providera',
    'Meno a priezvisko volajúceho',
  ];
  if (config.conversation.requireTerms) steps.push('Súhlas s podmienkami');
  steps.push('Záverečné zhrnutie termínu a záväzné vytvorenie rezervácie');
  if (config.conversation.sendConfirmationSms) steps.push('Potvrdzujúca SMS');
  return steps;
}

export function validateVoiceBotConfig(config: Partial<VoiceBotConfig>): VoiceBotConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.id || !ID_PATTERN.test(config.id)) {
    errors.push('ID bota musí mať 3 až 64 znakov: malé písmená, čísla a pomlčky.');
  }
  if (!config.clinic?.displayName?.trim()) errors.push('Zadajte názov kliniky.');
  if (!config.clinic?.specialty?.trim()) errors.push('Zadajte odbor kliniky.');
  if (config.clinic?.phoneNumber && !/^\+[1-9]\d{6,14}$/.test(config.clinic.phoneNumber.replace(/\s/g, ''))) {
    errors.push('Telefónne číslo zadajte v medzinárodnom formáte, napríklad +421900123456.');
  }
  const inboundNumbers = config.routing?.inboundTwilioNumbers || [];
  const normalizedInboundNumbers = inboundNumbers.map(normalizeTwilioNumber);
  for (const number of normalizedInboundNumbers) {
    if (!/^\+[1-9]\d{6,14}$/.test(number)) {
      errors.push('Twilio číslo bota zadajte v medzinárodnom formáte, napríklad +420910123456.');
    }
  }
  if (new Set(normalizedInboundNumbers).size !== normalizedInboundNumbers.length) {
    errors.push('Rovnaké Twilio číslo nemôže byť pri jednom botovi uvedené viackrát.');
  }
  if (!config.provider || !BOOKING_PROVIDERS.includes(config.provider.kind as BookingProviderKind)) {
    errors.push('Vyberte podporovaného booking providera.');
  }
  if (!config.services?.length) {
    errors.push('Pridajte aspoň jednu objednateľnú službu.');
  } else {
    const ids = new Set<string>();
    for (const service of config.services) {
      if (!service.id || !ID_PATTERN.test(service.id)) errors.push(`Služba „${service.label || 'bez názvu'}“ nemá platné ID.`);
      if (!service.label?.trim()) errors.push('Každá služba potrebuje názov, ktorý volajúci počuje.');
      if (ids.has(service.id)) errors.push(`ID služby „${service.id}“ je použité viackrát.`);
      ids.add(service.id);
      if (!service.voiceAliases?.length) warnings.push(`Služba „${service.label}“ nemá doplnené hlasové synonymá.`);
    }
  }
  if (config.provider?.mode === 'live' && !config.provider.connectionId?.trim()) {
    warnings.push('Live provider zatiaľ nemá vyplnené connection ID; konfigurácia je vhodná len na prípravu.');
  }
  if (config.conversation?.confirmName) {
    warnings.push('Potvrdzovanie mena predĺži hovor a pri rozpoznávaní mien môže pôsobiť neprirodzene.');
  }
  if (config.conversation && !config.conversation.useDtmfFallback) {
    warnings.push('Bez klávesnicového fallbacku bude bot citlivejší na chyby rozpoznávania hlasu.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export const bovClinicDemoConfig: VoiceBotConfig = {
  version: 1,
  id: 'bov-clinic-nitra-demo',
  clinic: {
    displayName: 'BOV Clinic',
    specialty: 'očná ambulancia',
    locale: 'sk-SK',
    timezone: 'Europe/Bratislava',
  },
  provider: { kind: 'bookio', mode: 'demo_mock' },
  routing: { inboundTwilioNumbers: [] },
  services: [
    { id: 'initial-exam', label: 'Vstupné očné vyšetrenie', durationMinutes: 20, voiceAliases: ['vstupné vyšetrenie', 'prvá návšteva'] },
    { id: 'follow-up', label: 'Kontrola', durationMinutes: 20, voiceAliases: ['kontrola'] },
    { id: 'acute-exam', label: 'Akútne vyšetrenie', durationMinutes: 20, voiceAliases: ['akútne vyšetrenie', 'zápal oka'] },
    { id: 'certificate-exam', label: 'Vyšetrenie na vodičský preukaz', durationMinutes: 20, voiceAliases: ['vodičský preukaz', 'zbrojný preukaz'] },
    { id: 'aesthetic-medicine', label: 'Estetická medicína', durationMinutes: 20, voiceAliases: ['estetická medicína'] },
  ],
  conversation: {
    confirmService: true,
    confirmDatePreference: true,
    confirmSlot: true,
    confirmName: false,
    requireTerms: true,
    sendConfirmationSms: true,
    useDtmfFallback: true,
    playPromptTone: true,
  },
  copy: {},
};
