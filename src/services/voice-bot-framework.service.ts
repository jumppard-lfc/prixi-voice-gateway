export const BOOKING_PROVIDERS = ['prixi', 'bookio', 'calendly', 'custom'] as const;

export type BookingProviderKind = typeof BOOKING_PROVIDERS[number];

export interface VoiceBotServiceDefinition {
  id: string;
  label: string;
  durationMinutes?: number;
  providerServiceId?: string;
  voiceAliases: string[];
}

/** A clinician or team member that can be selected after the service. */
export interface VoiceBotPractitionerDefinition {
  id: string;
  label: string;
  voiceAliases: string[];
  /** Empty means that this person can provide every configured service. */
  serviceIds?: string[];
}

export interface ConversationPolicy {
  confirmService: boolean;
  confirmDatePreference: boolean;
  confirmSlot: boolean;
  confirmName: boolean;
  /** Omitted configurations keep the original flow and do not ask for a practitioner. */
  confirmPractitioner?: boolean;
  requireTerms: boolean;
  sendConfirmationSms: boolean;
  useDtmfFallback: boolean;
  playPromptTone: boolean;
}

/**
 * A deliberately constrained conversation graph.  It is expressive enough for
 * an intake / booking call, while keeping every possible path reviewable in the
 * Builder.  It is not an open-ended AI prompt.
 */
export interface VoiceBotTreeChoice {
  id: string;
  /** What the patient hears in the confirmation and in summaries. */
  label: string;
  /** Deterministic phrases accepted from speech recognition. */
  voiceAliases: string[];
  /** One keypad digit.  It must be unique inside its question. */
  dtmf: string;
  nextNodeId: string;
  /** Optional value retained under the question's `storeAs` key. */
  value?: string;
}

export interface VoiceBotTreeQuestionNode {
  id: string;
  type: 'question';
  /** A friendly bridge spoken immediately before the actual question. */
  bridge?: string;
  prompt: string;
  /** Public HTTPS recording containing the complete bridge and question. */
  audioUrl?: string;
  /** Retains the selected label for {{variable}} placeholders later in the call. */
  storeAs?: string;
  confirmSelection: boolean;
  /** Optional wording. `{{selected}}` is replaced with the selected answer. */
  confirmationPrompt?: string;
  choices: VoiceBotTreeChoice[];
}

export interface VoiceBotTreeMessageNode {
  id: string;
  type: 'message';
  text: string;
  audioUrl?: string;
  nextNodeId: string;
}

/**
 * Looks up availability after prior choices (for example visit type and time
 * preference) and turns the returned slots into a deterministic choice menu.
 * `demo_mock` is the only source implemented today; provider connectors can
 * later implement the same contract without changing the conversation tree.
 */
export interface VoiceBotTreeAvailabilityNode {
  id: string;
  type: 'availability';
  bridge?: string;
  prompt?: string;
  audioUrl?: string;
  /** Key of a prior answer describing the requested visit. */
  serviceVariable: string;
  /** Optional prior answer such as "dopoludnia" or "popoludní". */
  preferenceVariable?: string;
  /** Key under which the selected formatted date/time is retained. */
  storeAs: string;
  confirmSelection: boolean;
  confirmationPrompt?: string;
  nextNodeId: string;
}

export interface VoiceBotTreeEndNode {
  id: string;
  type: 'end';
  text: string;
  audioUrl?: string;
  /** `mock_booking` is demo-only: it logs the outcome and may trigger the demo SMS. */
  outcome: 'complete' | 'handoff' | 'mock_booking';
  /** Used only for the mock booking confirmation SMS. */
  smsText?: string;
}

export type VoiceBotTreeNode = VoiceBotTreeQuestionNode | VoiceBotTreeMessageNode | VoiceBotTreeAvailabilityNode | VoiceBotTreeEndNode;

export interface VoiceBotConversationTree {
  entryNodeId: string;
  nodes: VoiceBotTreeNode[];
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
  practitioners?: VoiceBotPractitionerDefinition[];
  routing?: VoiceBotRouting;
  conversation: ConversationPolicy;
  /** When present, this replaces the built-in booking flow for this bot only. */
  conversationTree?: VoiceBotConversationTree;
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
  if (config.conversationTree) {
    return [
      'Transparentný úvod a vstupná otázka',
      `${config.conversationTree.nodes.filter((node) => node.type === 'question').length} deterministických otázok s vlastnými vetvami`,
      'Potvrdenie vybraných odpovedí a klávesnicový fallback po nepochopení',
      'Vlastné ukončenie každej vetvy',
    ];
  }
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
  if (!config.conversationTree && !config.services?.length) {
    errors.push('Pridajte aspoň jednu objednateľnú službu.');
  } else if (config.services?.length) {
    const ids = new Set<string>();
    for (const service of config.services) {
      if (!service.id || !ID_PATTERN.test(service.id)) errors.push(`Služba „${service.label || 'bez názvu'}“ nemá platné ID.`);
      if (!service.label?.trim()) errors.push('Každá služba potrebuje názov, ktorý volajúci počuje.');
      if (ids.has(service.id)) errors.push(`ID služby „${service.id}“ je použité viackrát.`);
      ids.add(service.id);
      if (!service.voiceAliases?.length) warnings.push(`Služba „${service.label}“ nemá doplnené hlasové synonymá.`);
    }
  }
  if (config.practitioners?.length) {
    const ids = new Set<string>();
    for (const practitioner of config.practitioners) {
      if (!practitioner.id || !ID_PATTERN.test(practitioner.id)) errors.push(`Člen tímu „${practitioner.label || 'bez názvu'}“ nemá platné ID.`);
      if (!practitioner.label?.trim()) errors.push('Každý člen tímu potrebuje meno, ktoré volajúci počuje.');
      if (ids.has(practitioner.id)) errors.push(`ID člena tímu „${practitioner.id}“ je použité viackrát.`);
      ids.add(practitioner.id);
      for (const serviceId of practitioner.serviceIds || []) {
        if (!config.services?.some((service) => service.id === serviceId)) {
          errors.push(`Člen tímu „${practitioner.label}“ odkazuje na neznámu službu „${serviceId}“.`);
        }
      }
      if (!practitioner.voiceAliases?.length) warnings.push(`Člen tímu „${practitioner.label}“ nemá doplnené hlasové synonymá.`);
    }
    if (config.practitioners.length > 7) warnings.push('Výber člena tímu bude rozdelený do viacerých stránok klávesnicového menu.');
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

  if (config.conversationTree) {
    validateConversationTree(config.conversationTree, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateConversationTree(tree: VoiceBotConversationTree, errors: string[], warnings: string[]): void {
  if (!tree.entryNodeId) errors.push('Rozhodovací strom potrebuje úvodný uzol.');
  if (!tree.nodes?.length) {
    errors.push('Rozhodovací strom potrebuje aspoň jednu otázku alebo ukončenie.');
    return;
  }

  const ids = new Set<string>();
  const nodeIds = new Set(tree.nodes.map((node) => node.id));
  for (const node of tree.nodes) {
    if (!node.id || !ID_PATTERN.test(node.id)) errors.push(`Uzol „${node.id || 'bez ID'}“ musí mať platné ID.`);
    if (ids.has(node.id)) errors.push(`ID uzla „${node.id}“ je použité viackrát.`);
    ids.add(node.id);
    if (node.audioUrl && !isPublicHttpsUrl(node.audioUrl)) errors.push(`Nahrávka uzla „${node.id}“ musí mať verejnú HTTPS URL.`);

    if (node.type === 'question') {
      if (!node.prompt.trim()) errors.push(`Otázka „${node.id}“ nemá text.`);
      if (!node.choices.length) errors.push(`Otázka „${node.id}“ potrebuje aspoň jednu odpoveď.`);
      const digits = new Set<string>();
      for (const choice of node.choices) {
        if (!choice.id || !ID_PATTERN.test(choice.id)) errors.push(`Odpoveď v uzle „${node.id}“ nemá platné ID.`);
        if (!choice.label.trim()) errors.push(`Odpoveď v uzle „${node.id}“ nemá názov.`);
        if (!/^[0-9]$/.test(choice.dtmf)) errors.push(`Odpoveď „${choice.label || choice.id}“ musí mať jedno číslo klávesnice 0 až 9.`);
        if (digits.has(choice.dtmf)) errors.push(`Otázka „${node.id}“ používa klávesu ${choice.dtmf} viackrát.`);
        digits.add(choice.dtmf);
        if (!choice.voiceAliases?.length) warnings.push(`Odpoveď „${choice.label || choice.id}“ v uzle „${node.id}“ nemá hlasové synonymá.`);
        if (!nodeIds.has(choice.nextNodeId)) errors.push(`Odpoveď „${choice.label || choice.id}“ odkazuje na neznámy uzol „${choice.nextNodeId}“.`);
      }
    } else if (node.type === 'availability') {
      if (!node.serviceVariable?.trim()) errors.push(`Uzol voľných termínov „${node.id}“ potrebuje premennú služby.`);
      if (!node.storeAs?.trim()) errors.push(`Uzol voľných termínov „${node.id}“ potrebuje názov premennej termínu.`);
      if (!nodeIds.has(node.nextNodeId)) errors.push(`Uzol voľných termínov „${node.id}“ odkazuje na neznámy uzol „${node.nextNodeId}“.`);
    } else if (node.type === 'message') {
      if (!node.text.trim() && !node.audioUrl) errors.push(`Správa „${node.id}“ potrebuje text alebo nahrávku.`);
      if (!nodeIds.has(node.nextNodeId)) errors.push(`Správa „${node.id}“ odkazuje na neznámy uzol „${node.nextNodeId}“.`);
    } else if (node.type === 'end') {
      if (!node.text.trim() && !node.audioUrl) errors.push(`Ukončenie „${node.id}“ potrebuje text alebo nahrávku.`);
    }
  }
  if (tree.entryNodeId && !nodeIds.has(tree.entryNodeId)) errors.push(`Úvodný uzol „${tree.entryNodeId}“ neexistuje.`);
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
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
