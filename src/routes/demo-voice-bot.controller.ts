import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import { bulkGateSmsService } from '../services/bulkgate-sms.service';
import { bookingAuditService } from '../services/booking-audit.service';
import { parseDatePreference, parseName, parseSlotChoice, parseYesNo } from '../services/booking-nlu.service';
import { voiceBotConfigStore } from '../services/voice-bot-config.store';
import {
  buildIntroduction,
  VoiceBotConfig,
  VoiceBotPractitionerDefinition,
  VoiceBotServiceDefinition,
  VoiceBotTreeChoice,
  VoiceBotTreeEndNode,
  VoiceBotTreeMessageNode,
  VoiceBotTreeNode,
  VoiceBotTreeQuestionNode,
} from '../services/voice-bot-framework.service';
import { DatePreference, OfferedSlot } from '../types';

const VoiceResponse = twilio.twiml.VoiceResponse;
const SESSION_TTL_MS = 20 * 60 * 1000;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' };

type DemoStep = 'service' | 'practitioner' | 'date_preference' | 'slot' | 'name' | 'terms' | 'verification' | 'confirmation';
type VerificationTarget = 'service' | 'practitioner' | 'date_preference' | 'slot' | 'name';
const MENU_PAGE_SIZE = 7;

interface DemoSession {
  callSid: string;
  phone: string;
  config: VoiceBotConfig;
  publicBaseUrl: string;
  step: DemoStep;
  verificationTarget?: VerificationTarget;
  service?: VoiceBotServiceDefinition;
  practitioner?: VoiceBotPractitionerDefinition;
  preference?: DatePreference;
  offeredSlots?: OfferedSlot[];
  selectedSlot?: OfferedSlot;
  firstName?: string;
  lastName?: string;
  acceptedTerms?: boolean;
  practitionerPage: number;
  forceDtmf?: boolean;
  expiresAt: number;
}

const sessions = new Map<string, DemoSession>();

interface TreeSession {
  callSid: string;
  phone: string;
  config: VoiceBotConfig;
  publicBaseUrl: string;
  nodeId: string;
  answers: Record<string, { label: string; value?: string }>;
  pendingConfirmation?: { nodeId: string; choiceId: string };
  forceDtmf?: boolean;
  expiresAt: number;
}

const treeSessions = new Map<string, TreeSession>();

function normalize(value: string): string {
  return value.toLocaleLowerCase('sk-SK').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function formatSlot(slot: OfferedSlot): string {
  return new Intl.DateTimeFormat('sk-SK', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bratislava',
  }).format(new Date(slot.startAt));
}

function publicBaseUrl(request: FastifyRequest): string {
  const protocol = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  return (process.env.PUBLIC_BASE_URL || `${protocol}://${host}`).replace(/\/$/, '');
}

function save(session: DemoSession): void {
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(session.callSid, session);
}

function get(callSid: string): DemoSession | undefined {
  const session = sessions.get(callSid);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(callSid);
    return undefined;
  }
  return session;
}

function createSession(callSid: string, phone: string, config: VoiceBotConfig, baseUrl: string): DemoSession {
  const session: DemoSession = { callSid, phone, config, publicBaseUrl: baseUrl, step: 'service', practitionerPage: 0, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(callSid, session);
  return session;
}

function mockSlots(service: VoiceBotServiceDefinition, preference: DatePreference): OfferedSlot[] {
  const requestedHours = preference.timeOfDay === 'afternoon' ? [14, 20] : [9, 40];
  const allowedWeekdays = [1, 3, 5];
  const slots: OfferedSlot[] = [];
  const cursor = new Date();
  cursor.setMinutes(0, 0, 0);

  while (slots.length < 3) {
    cursor.setDate(cursor.getDate() + 1);
    if (!allowedWeekdays.includes(cursor.getDay())) continue;
    const start = new Date(cursor);
    start.setHours(requestedHours[0], requestedHours[1], 0, 0);
    slots.push({ id: `demo-${service.id}-${start.toISOString()}`, startAt: start.toISOString(), serviceName: service.label });
  }
  return slots;
}

function parseService(value: string, services: VoiceBotServiceDefinition[]): VoiceBotServiceDefinition | undefined {
  const text = normalize(value);
  const digit = Number(text);
  if (Number.isInteger(digit) && digit >= 1 && digit <= services.length) return services[digit - 1];
  return services.find((service) => [service.label, ...service.voiceAliases]
    .map(normalize)
    .some((alias) => text.includes(alias)));
}

function parsePractitioner(value: string, practitioners: VoiceBotPractitionerDefinition[]): VoiceBotPractitionerDefinition | undefined {
  const text = normalize(value);
  const digit = Number(text);
  if (Number.isInteger(digit) && digit >= 1 && digit <= practitioners.length) return practitioners[digit - 1];
  return practitioners.find((practitioner) => [practitioner.label, ...practitioner.voiceAliases]
    .map(normalize)
    .some((alias) => text.includes(alias)));
}

function pageItems<T>(items: T[], page: number): T[] {
  return items.slice(page * MENU_PAGE_SIZE, (page + 1) * MENU_PAGE_SIZE);
}

function canGoToPreviousPage(page: number): boolean {
  return page > 0;
}

function canGoToNextPage(items: unknown[], page: number): boolean {
  return (page + 1) * MENU_PAGE_SIZE < items.length;
}

function navigationPrompt(items: unknown[], page: number): string {
  return `${canGoToPreviousPage(page) ? ' Pre predchádzajúce možnosti stlačte 8.' : ''}${canGoToNextPage(items, page) ? ' Pre ďalšie možnosti stlačte 9.' : ''}`;
}

function practitionersForService(session: DemoSession): VoiceBotPractitionerDefinition[] {
  if (!session.service) return [];
  return (session.config.practitioners || []).filter((practitioner) => !practitioner.serviceIds?.length
    || practitioner.serviceIds.includes(session.service!.id));
}

function continueAfterService(session: DemoSession): DemoStep {
  const practitioners = practitionersForService(session);
  if (practitioners.length === 1) session.practitioner = practitioners[0];
  session.practitionerPage = 0;
  session.step = practitioners.length > 1 ? 'practitioner' : 'date_preference';
  return session.step;
}

function verificationText(session: DemoSession): string {
  switch (session.verificationTarget) {
    case 'service': return `Ďakujem. Rozumela som správne, že sa chcete objednať na ${session.service?.label}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'practitioner': return `Ďakujem. Rozumela som správne, že preferujete termín u ${session.practitioner?.label}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'date_preference': return `Ďakujem. Rozumela som správne, že preferujete ${session.preference?.timeOfDay === 'morning' ? 'termín dopoludnia' : session.preference?.timeOfDay === 'afternoon' ? 'termín popoludní' : 'najbližší voľný termín'}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'slot': return `Ďakujem. Rozumela som správne, že vám vyhovuje ${session.selectedSlot ? formatSlot(session.selectedSlot) : 'tento termín'}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'name': return `Rozumela som správne, že sa voláte ${session.firstName} ${session.lastName}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    default: return 'Rozumela som vám správne? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.';
  }
}

function ask(reply: FastifyReply, session: DemoSession, message: string, hints = '', forceDtmf = false): FastifyReply {
  save(session);
  const twiml = new VoiceResponse();
  const serviceDtmfFallback = forceDtmf && session.step === 'service';
  const serviceSpeechFirst = !forceDtmf && session.step === 'service';
  const expectsSingleDigit = session.step !== 'name' && !serviceDtmfFallback;
  const gather = twiml.gather({
    input: forceDtmf ? ['dtmf'] : serviceSpeechFirst ? ['speech'] : ['speech', 'dtmf'],
    action: `/voice/demo/${session.config.id}/answer`, method: 'POST', timeout: 5, speechTimeout: 'auto', language: 'sk-SK', hints,
    ...(expectsSingleDigit ? { numDigits: 1 } : serviceDtmfFallback ? { numDigits: 2, finishOnKey: '#' } : {}),
  } as any);
  gather.say(sayOptions, message);
  if (session.config.conversation.playPromptTone) gather.play(`${session.publicBaseUrl}/media/booking-prompt-tone.wav`);
  twiml.say(sayOptions, 'Odpoveď som nezachytila. Skúsme to, prosím, znova.');
  twiml.redirect(`/voice/demo/${session.config.id}/retry`);
  return reply.type('text/xml').send(twiml.toString());
}

function prompt(reply: FastifyReply, session: DemoSession, prefix = ''): FastifyReply {
  const forceDtmf = session.forceDtmf === true;
  session.forceDtmf = false;
  const keyboard = forceDtmf ? 'Prosím, pre istotu teraz použite klávesnicu. ' : '';

  switch (session.step) {
    case 'service': {
      if (!forceDtmf) {
        const examples = session.config.services.slice(0, 5).map((service) => service.voiceAliases[0] || service.label).join(', ');
        return ask(reply, session, `${prefix}Povedzte mi, prosím, na akú návštevu sa chcete objednať. Môžete povedať napríklad ${examples}.`, session.config.services.flatMap((service) => [service.label, ...service.voiceAliases]).join(', '));
      }
      const options = session.config.services.map((service, index) => `Pre ${service.label} stlačte ${index + 1}.`).join(' ');
      return ask(reply, session, `${prefix}${keyboard}${options} Zadajte číslo služby a potvrďte ho tlačidlom mriežka.`, '', true);
    }
    case 'practitioner': {
      const practitioners = practitionersForService(session);
      const visiblePractitioners = pageItems(practitioners, session.practitionerPage);
      const options = visiblePractitioners.map((practitioner, index) => `Pre termín u ${practitioner.label} stlačte ${index + 1}${forceDtmf ? '.' : ` alebo povedzte ${practitioner.voiceAliases[0] || practitioner.label}.`}`).join(' ');
      return ask(reply, session, `${prefix}${keyboard}Vyberte si, prosím, člena tímu. ${options}${navigationPrompt(practitioners, session.practitionerPage)}`, visiblePractitioners.flatMap((practitioner) => [practitioner.label, ...practitioner.voiceAliases]).join(', '), forceDtmf);
    }
    case 'date_preference':
      return ask(reply, session, `${prefix}${keyboard}Pre najbližší termín stlačte 1. Pre dopoludnie stlačte 2. Pre popoludnie stlačte 3.${forceDtmf ? '' : ' Môžete odpovedať aj hlasom.'}`, 'najbližší termín, dopoludnie, doobeda, popoludnie', forceDtmf);
    case 'slot': {
      const slots = session.offeredSlots || [];
      const choices = slots.map((slot, index) => `možnosť ${index + 1}: ${formatSlot(slot)}`).join('. ');
      const weekdayHints = slots.map((slot) => new Intl.DateTimeFormat('sk-SK', { weekday: 'long', timeZone: 'Europe/Bratislava' }).format(new Date(slot.startAt))).join(', ');
      return ask(reply, session, `${prefix}${keyboard}Mám tieto demo termíny. ${choices}. ${forceDtmf ? 'Stlačte číslo možnosti.' : 'Povedzte číslo možnosti alebo názov dňa.'}`, `prvá možnosť, druhá možnosť, tretia možnosť, ${weekdayHints}`, forceDtmf);
    }
    case 'name': return ask(reply, session, `${prefix}Prosím, povedzte vaše meno a priezvisko.`);
    case 'terms': return ask(reply, session, `${prefix}Súhlasíte so všeobecnými obchodnými podmienkami ambulancie? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`, 'áno, nie', forceDtmf);
    case 'verification': return ask(reply, session, verificationText(session), 'áno, nie', forceDtmf);
    case 'confirmation': return ask(reply, session, `${prefix}Potvrdzujem: ${session.service?.label}, ${session.selectedSlot ? formatSlot(session.selectedSlot) : ''}. Môžem tento demo termín záväzne vytvoriť? Povedzte áno alebo stlačte 1. Pre zmenu termínu stlačte 2.`, 'áno, nie', forceDtmf);
  }
}

function beginVerification(session: DemoSession, target: VerificationTarget): void {
  session.verificationTarget = target;
  session.step = 'verification';
}

async function sendDemoConfirmationSms(session: DemoSession): Promise<boolean> {
  if (!session.config.conversation.sendConfirmationSms || process.env.DEMO_BOOKING_SMS_ENABLED !== 'true') return false;
  if (process.env.NODE_ENV === 'test') return true;
  await bulkGateSmsService.sendTransactionalSms(session.phone, `${session.config.clinic.displayName}: váš demo termín ${formatSlot(session.selectedSlot!)} je potvrdený.`, 'demo-booking-confirmation');
  return true;
}

function createTreeSession(callSid: string, phone: string, config: VoiceBotConfig, baseUrl: string): TreeSession {
  const session: TreeSession = {
    callSid,
    phone,
    config,
    publicBaseUrl: baseUrl,
    nodeId: config.conversationTree!.entryNodeId,
    answers: {},
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  treeSessions.set(callSid, session);
  return session;
}

function getTreeSession(callSid: string): TreeSession | undefined {
  const session = treeSessions.get(callSid);
  if (!session || session.expiresAt <= Date.now()) {
    treeSessions.delete(callSid);
    return undefined;
  }
  return session;
}

function saveTreeSession(session: TreeSession): void {
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  treeSessions.set(session.callSid, session);
}

function treeNode(session: TreeSession, nodeId = session.nodeId): VoiceBotTreeNode | undefined {
  return session.config.conversationTree?.nodes.find((node) => node.id === nodeId);
}

function interpolateTreeText(value: string | undefined, session: TreeSession, selected = ''): string {
  return (value || '').replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (_match, key: string) => {
    if (key === 'selected') return selected;
    return session.answers[key]?.label || '';
  });
}

function parseTreeChoice(value: string, node: VoiceBotTreeQuestionNode): VoiceBotTreeChoice | undefined {
  const text = normalize(value);
  return node.choices.find((choice) => text === choice.dtmf
    || [choice.label, ...choice.voiceAliases].map(normalize).some((alias) => text === alias || text.includes(alias)));
}

function commitTreeChoice(session: TreeSession, node: VoiceBotTreeQuestionNode, choice: VoiceBotTreeChoice): void {
  if (node.storeAs) session.answers[node.storeAs] = { label: choice.label, value: choice.value };
  bookingAuditService.record(session.callSid, 'tree_choice_selected', { nodeId: node.id, choiceId: choice.id, value: choice.value });
  session.nodeId = choice.nextNodeId;
  session.pendingConfirmation = undefined;
}

function addTreeAudioOrSpeech(target: any, text: string, audioUrl?: string): void {
  if (audioUrl) target.play(audioUrl);
  else if (text.trim()) target.say(sayOptions, text);
}

async function sendTreeDemoSms(session: TreeSession, node: VoiceBotTreeEndNode): Promise<boolean> {
  if (node.outcome !== 'mock_booking' || !session.config.conversation.sendConfirmationSms || process.env.DEMO_BOOKING_SMS_ENABLED !== 'true') return false;
  if (process.env.NODE_ENV === 'test') return true;
  const fallback = `${session.config.clinic.displayName}: vaša demo požiadavka je potvrdená.`;
  await bulkGateSmsService.sendTransactionalSms(session.phone, interpolateTreeText(node.smsText, session) || fallback, 'demo-booking-confirmation');
  return true;
}

function expiredTreeResponse(reply: FastifyReply): FastifyReply {
  const twiml = new VoiceResponse();
  twiml.say(sayOptions, 'Platnosť hovoru vypršala. Zavolajte, prosím, znovu.');
  twiml.hangup();
  return reply.type('text/xml').send(twiml.toString());
}

async function renderTree(reply: FastifyReply, session: TreeSession, prefix = ''): Promise<FastifyReply> {
  const twiml = new VoiceResponse();
  const preambles: Array<{ text: string; audioUrl?: string }> = prefix ? [{ text: prefix }] : [];
  let node = treeNode(session);
  let hops = 0;

  while (node?.type === 'message' && hops < 12) {
    const message = node as VoiceBotTreeMessageNode;
    preambles.push({ text: interpolateTreeText(message.text, session), audioUrl: message.audioUrl });
    session.nodeId = message.nextNodeId;
    node = treeNode(session);
    hops += 1;
  }

  if (!node || hops >= 12) {
    twiml.say(sayOptions, 'Konfigurácia rozhovoru nie je úplná. Ďakujeme a dovidenia.');
    twiml.hangup();
    treeSessions.delete(session.callSid);
    return reply.type('text/xml').send(twiml.toString());
  }

  if (node.type === 'end') {
    const end = node as VoiceBotTreeEndNode;
    for (const preamble of preambles) addTreeAudioOrSpeech(twiml, preamble.text, preamble.audioUrl);
    let smsDelivered = false;
    if (end.outcome === 'mock_booking') {
      bookingAuditService.record(session.callSid, 'booking_created', { bookingId: `tree-demo-${Date.now()}`, provider: 'demo_mock', mode: 'conversation_tree' });
      try {
        smsDelivered = await sendTreeDemoSms(session, end);
        bookingAuditService.record(session.callSid, smsDelivered ? 'sms_sent' : 'sms_skipped', { mode: smsDelivered ? 'bulkgate' : 'disabled', to: session.phone });
      } catch (error) {
        bookingAuditService.record(session.callSid, 'sms_failed', { message: error instanceof Error ? error.message : String(error) });
      }
    }
    addTreeAudioOrSpeech(twiml, interpolateTreeText(end.text, session), end.audioUrl);
    twiml.hangup();
    bookingAuditService.record(session.callSid, 'completed', { outcome: end.outcome, smsDelivered, mode: 'conversation_tree' });
    treeSessions.delete(session.callSid);
    return reply.type('text/xml').send(twiml.toString());
  }

  const question = node as VoiceBotTreeQuestionNode;
  saveTreeSession(session);
  const forceDtmf = session.forceDtmf === true;
  session.forceDtmf = false;
  const gather = twiml.gather({
    input: forceDtmf ? ['dtmf'] : ['speech', 'dtmf'],
    action: `/voice/demo/${session.config.id}/tree/answer`,
    method: 'POST',
    timeout: 5,
    speechTimeout: 'auto',
    language: 'sk-SK',
    hints: question.choices.flatMap((choice) => [choice.label, ...choice.voiceAliases]).join(', '),
    numDigits: 1,
  } as any);
  for (const preamble of preambles) addTreeAudioOrSpeech(gather, preamble.text, preamble.audioUrl);
  const fallback = forceDtmf ? 'Prosím, pre istotu teraz použite klávesnicu. ' : '';
  addTreeAudioOrSpeech(gather, `${fallback}${interpolateTreeText(question.bridge, session)} ${interpolateTreeText(question.prompt, session)}`.trim(), question.audioUrl);
  if (session.config.conversation.playPromptTone) gather.play(`${session.publicBaseUrl}/media/booking-prompt-tone.wav`);
  twiml.say(sayOptions, 'Odpoveď som nezachytila. Skúsme to, prosím, znova.');
  twiml.redirect(`/voice/demo/${session.config.id}/tree/retry`);
  return reply.type('text/xml').send(twiml.toString());
}

async function renderTreeConfirmation(reply: FastifyReply, session: TreeSession, node: VoiceBotTreeQuestionNode, choice: VoiceBotTreeChoice): Promise<FastifyReply> {
  saveTreeSession(session);
  const twiml = new VoiceResponse();
  const gather = twiml.gather({ input: ['speech', 'dtmf'], action: `/voice/demo/${session.config.id}/tree/answer`, method: 'POST', timeout: 5, speechTimeout: 'auto', language: 'sk-SK', hints: 'áno, nie', numDigits: 1 } as any);
  const fallback = `Ďakujem. Rozumela som správne, že si prajete ${choice.label}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
  gather.say(sayOptions, interpolateTreeText(node.confirmationPrompt, session, choice.label) || fallback);
  if (session.config.conversation.playPromptTone) gather.play(`${session.publicBaseUrl}/media/booking-prompt-tone.wav`);
  twiml.say(sayOptions, 'Odpoveď som nezachytila. Skúsme to, prosím, znova.');
  twiml.redirect(`/voice/demo/${session.config.id}/tree/retry`);
  return reply.type('text/xml').send(twiml.toString());
}

export async function demoVoiceBotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/demo/:botId/incoming', async (request, reply) => {
    const botId = (request.params as { botId: string }).botId;
    const config = await voiceBotConfigStore.get(botId);
    const twiml = new VoiceResponse();
    if (!config || config.provider.mode !== 'demo_mock') {
      twiml.say(sayOptions, 'Tento demo bot nie je dostupný.'); twiml.hangup();
    } else {
      twiml.redirect(`/voice/demo/${config.id}/start`);
    }
    return reply.type('text/xml').send(twiml.toString());
  });

  fastify.post('/demo/:botId/start', async (request, reply) => {
    const botId = (request.params as { botId: string }).botId;
    const config = await voiceBotConfigStore.get(botId);
    if (!config || config.provider.mode !== 'demo_mock') {
      const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Tento demo bot nie je dostupný.'); twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    const body = request.body as Record<string, string>;
    if (config.conversationTree) {
      const session = createTreeSession(body.CallSid, body.From, config, publicBaseUrl(request));
      bookingAuditService.record(session.callSid, 'started', { botId: config.id, phone: session.phone, mode: 'conversation_tree' });
      return renderTree(reply, session, buildIntroduction(config));
    }
    const session = createSession(body.CallSid, body.From, config, publicBaseUrl(request));
    bookingAuditService.record(session.callSid, 'started', { botId: config.id, phone: session.phone });
    return prompt(reply, session, buildIntroduction(config));
  });

  fastify.post('/demo/:botId/retry', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = get(body.CallSid);
    if (!session) {
      const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Platnosť objednávky vypršala. Zavolajte, prosím, znovu.'); twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    session.forceDtmf = session.step !== 'name' && session.config.conversation.useDtmfFallback;
    return prompt(reply, session, 'Prepáčte, nerozumela som. ');
  });

  fastify.post('/demo/:botId/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = get(body.CallSid);
    if (!session) {
      const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Platnosť objednávky vypršala. Zavolajte, prosím, znovu.'); twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }
    const answer = body.SpeechResult || body.Digits || '';

    if (session.step === 'verification') {
      const yes = parseYesNo(answer);
      const target = session.verificationTarget;
      if (yes === true && target) {
        session.verificationTarget = undefined;
        if (target === 'service') {
          const nextStep = continueAfterService(session);
          return prompt(reply, session, nextStep === 'practitioner'
            ? 'Ďakujem. Najprv si spolu vyberieme člena tímu. '
            : 'Ďakujem. Poďme teraz spoločne vybrať termín, ktorý by vám vyhovoval. ');
        }
        if (target === 'practitioner') {
          session.step = 'date_preference';
          return prompt(reply, session, 'Ďakujem. Poďme teraz spoločne vybrať termín, ktorý by vám vyhovoval. ');
        }
        if (target === 'date_preference' && session.service && session.preference) {
          session.offeredSlots = mockSlots(session.service, session.preference);
          session.step = 'slot';
          bookingAuditService.record(session.callSid, 'slots_offered', { count: session.offeredSlots.length, mode: 'demo_mock' });
          return prompt(reply, session, 'Ďakujem. Pozrime sa spolu na voľné termíny. ');
        }
        if (target === 'slot') {
          session.step = 'name';
          return prompt(reply, session, 'Ďakujem. Teraz dokončíme údaje k objednávke. ');
        }
        if (target === 'name') {
          session.step = session.config.conversation.requireTerms ? 'terms' : 'confirmation';
          return prompt(reply, session, session.config.conversation.requireTerms
            ? 'Ďakujem. Pred dokončením objednávky si spolu potvrdíme všeobecné podmienky. '
            : 'Ďakujem. Ešte krátko zhrniem vybraný termín. ');
        }
      }
      if (yes === false && target) {
        session.verificationTarget = undefined;
        session.step = target;
        session.forceDtmf = target !== 'name';
        if (target === 'service') session.service = undefined;
        if (target === 'practitioner') session.practitioner = undefined;
        if (target === 'date_preference') session.preference = undefined;
        if (target === 'slot') session.selectedSlot = undefined;
        if (target === 'name') { session.firstName = undefined; session.lastName = undefined; }
        return prompt(reply, session, target === 'name' ? 'Ospravedlňujem sa. ' : 'Ospravedlňujem sa. ');
      }
    } else if (session.step === 'service') {
      const service = parseService(answer, session.config.services);
      if (service) {
        session.service = service;
        bookingAuditService.record(session.callSid, 'service_selected', { service: service.id });
        const nextStep = session.config.conversation.confirmService ? undefined : continueAfterService(session);
        if (session.config.conversation.confirmService) beginVerification(session, 'service');
        return prompt(reply, session, session.config.conversation.confirmService ? '' : nextStep === 'practitioner'
          ? 'Ďakujem. Najprv si spolu vyberieme člena tímu. '
          : 'Ďakujem. Poďme teraz spoločne vybrať termín, ktorý by vám vyhovoval. ');
      }
    } else if (session.step === 'practitioner') {
      const practitioners = practitionersForService(session);
      const visiblePractitioners = pageItems(practitioners, session.practitionerPage);
      const digit = Number(normalize(answer));
      if (digit === 8 && canGoToPreviousPage(session.practitionerPage)) {
        session.practitionerPage -= 1;
        return prompt(reply, session, 'Tu sú predchádzajúci členovia tímu. ');
      }
      if (digit === 9 && canGoToNextPage(practitioners, session.practitionerPage)) {
        session.practitionerPage += 1;
        return prompt(reply, session, 'Tu sú ďalší členovia tímu. ');
      }
      const practitioner = parsePractitioner(answer, visiblePractitioners);
      if (practitioner) {
        session.practitioner = practitioner;
        bookingAuditService.record(session.callSid, 'practitioner_selected', { practitioner: practitioner.id });
        if (session.config.conversation.confirmPractitioner !== false) beginVerification(session, 'practitioner');
        else session.step = 'date_preference';
        return prompt(reply, session, session.config.conversation.confirmPractitioner !== false ? '' : 'Ďakujem. Poďme teraz spoločne vybrať termín, ktorý by vám vyhovoval. ');
      }
    } else if (session.step === 'date_preference') {
      const preference = parseDatePreference(answer);
      if (preference && session.service) {
        session.preference = preference;
        if (session.config.conversation.confirmDatePreference) {
          beginVerification(session, 'date_preference');
          return prompt(reply, session);
        }
        session.offeredSlots = mockSlots(session.service, preference);
        session.step = 'slot';
        bookingAuditService.record(session.callSid, 'slots_offered', { count: session.offeredSlots.length, mode: 'demo_mock' });
        return prompt(reply, session, 'Ďakujem. Pozrime sa spolu na voľné termíny. ');
      }
    } else if (session.step === 'slot') {
      const choice = parseSlotChoice(answer, session.offeredSlots || []);
      if (choice !== undefined && session.offeredSlots?.[choice]) {
        session.selectedSlot = session.offeredSlots[choice];
        bookingAuditService.record(session.callSid, 'slot_selected', { slotId: session.selectedSlot.id, mode: 'demo_mock' });
        if (session.config.conversation.confirmSlot) beginVerification(session, 'slot');
        else session.step = 'name';
        return prompt(reply, session, session.config.conversation.confirmSlot ? '' : 'Ďakujem. Teraz dokončíme údaje k objednávke. ');
      }
    } else if (session.step === 'name') {
      const name = parseName(answer);
      if (name) {
        session.firstName = name.firstName; session.lastName = name.lastName;
        bookingAuditService.record(session.callSid, 'identity_collected');
        if (session.config.conversation.confirmName) {
          beginVerification(session, 'name');
          return prompt(reply, session);
        }
        session.step = session.config.conversation.requireTerms ? 'terms' : 'confirmation';
        return prompt(reply, session, session.config.conversation.requireTerms
          ? 'Ďakujem. Pred dokončením objednávky si spolu potvrdíme všeobecné podmienky. '
          : 'Ďakujem. Ešte krátko zhrniem vybraný termín. ');
      }
    } else if (session.step === 'terms') {
      const yes = parseYesNo(answer);
      if (yes === true) {
        session.acceptedTerms = true; session.step = 'confirmation';
        bookingAuditService.record(session.callSid, 'terms_accepted');
        return prompt(reply, session, 'Ďakujem. Ešte krátko zhrniem vybraný termín. ');
      }
      if (yes === false) {
        const twiml = new VoiceResponse(); twiml.say(sayOptions, 'Bez súhlasu s podmienkami objednávku nevieme vytvoriť. Ďakujeme a dovidenia.'); twiml.hangup(); sessions.delete(session.callSid);
        return reply.type('text/xml').send(twiml.toString());
      }
    } else if (session.step === 'confirmation') {
      const yes = parseYesNo(answer);
      if (yes === false) {
        session.step = 'slot'; session.forceDtmf = true;
        return prompt(reply, session, 'Rozumiem, vyberme iný termín. ');
      }
      if (yes === true && session.service && session.selectedSlot && session.firstName && session.lastName && (!session.config.conversation.requireTerms || session.acceptedTerms)) {
        bookingAuditService.record(session.callSid, 'booking_created', { bookingId: `demo-${Date.now()}`, provider: 'demo_mock' });
        let smsDelivered = false;
        try {
          smsDelivered = await sendDemoConfirmationSms(session);
          if (smsDelivered) bookingAuditService.record(session.callSid, 'sms_sent', { mode: process.env.NODE_ENV === 'test' ? 'test_mock' : 'bulkgate', to: session.phone });
        } catch (error) {
          bookingAuditService.record(session.callSid, 'sms_failed', { message: error instanceof Error ? error.message : String(error) });
          fastify.log.error(error, 'Demo booking confirmation SMS failed');
        }
        bookingAuditService.record(session.callSid, 'completed', { smsDelivered, mode: 'demo_mock' });
        const twiml = new VoiceResponse();
        const closing = smsDelivered
          ? 'Ďakujem. Demo termín je vytvorený a potvrdenie vám posielame SMS správou.'
          : 'Ďakujem. Demo termín je vytvorený. Potvrdzujúca SMS pre tento demo bot zatiaľ nie je zapnutá.';
        twiml.say(sayOptions, `${closing} ${session.config.copy.closing || 'Ďakujeme a dovidenia.'}`); twiml.hangup(); sessions.delete(session.callSid);
        return reply.type('text/xml').send(twiml.toString());
      }
    }

    session.forceDtmf = session.step !== 'name' && session.config.conversation.useDtmfFallback;
    return prompt(reply, session, session.step === 'name' ? 'Prepáčte, meno som nezachytila. ' : 'Prepáčte, nerozumela som. ');
  });

  fastify.post('/demo/:botId/tree/retry', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = getTreeSession(body.CallSid);
    if (!session) return expiredTreeResponse(reply);
    session.forceDtmf = session.config.conversation.useDtmfFallback;
    return renderTree(reply, session, 'Prepáčte, nerozumela som. ');
  });

  fastify.post('/demo/:botId/tree/answer', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const session = getTreeSession(body.CallSid);
    if (!session) return expiredTreeResponse(reply);
    const answer = body.SpeechResult || body.Digits || '';

    if (session.pendingConfirmation) {
      const pending = session.pendingConfirmation;
      const node = treeNode(session, pending.nodeId);
      const choice = node?.type === 'question' ? node.choices.find((item) => item.id === pending.choiceId) : undefined;
      const yes = parseYesNo(answer);
      if (node?.type === 'question' && choice && yes === true) {
        commitTreeChoice(session, node, choice);
        return renderTree(reply, session, 'Ďakujem. ');
      }
      if (node?.type === 'question' && choice && yes === false) {
        session.pendingConfirmation = undefined;
        session.forceDtmf = session.config.conversation.useDtmfFallback;
        return renderTree(reply, session, 'Ospravedlňujem sa. Vyberme to, prosím, ešte raz. ');
      }
      return renderTreeConfirmation(reply, session, node as VoiceBotTreeQuestionNode, choice as VoiceBotTreeChoice);
    }

    const node = treeNode(session);
    if (node?.type !== 'question') return renderTree(reply, session);
    const choice = parseTreeChoice(answer, node);
    if (!choice) {
      session.forceDtmf = session.config.conversation.useDtmfFallback;
      return renderTree(reply, session, 'Prepáčte, nerozumela som. ');
    }
    if (node.confirmSelection) {
      session.pendingConfirmation = { nodeId: node.id, choiceId: choice.id };
      return renderTreeConfirmation(reply, session, node, choice);
    }
    commitTreeChoice(session, node, choice);
    return renderTree(reply, session, 'Ďakujem. ');
  });
}
