import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';
import { bulkGateSmsService } from '../services/bulkgate-sms.service';
import { bookingAuditService } from '../services/booking-audit.service';
import { parseDatePreference, parseName, parseSlotChoice, parseYesNo } from '../services/booking-nlu.service';
import { voiceBotConfigStore } from '../services/voice-bot-config.store';
import { buildIntroduction, VoiceBotConfig, VoiceBotServiceDefinition } from '../services/voice-bot-framework.service';
import { DatePreference, OfferedSlot } from '../types';

const VoiceResponse = twilio.twiml.VoiceResponse;
const SESSION_TTL_MS = 20 * 60 * 1000;
const sayOptions: any = { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' };

type DemoStep = 'service' | 'date_preference' | 'slot' | 'name' | 'terms' | 'verification' | 'confirmation';
type VerificationTarget = 'service' | 'date_preference' | 'slot' | 'name';

interface DemoSession {
  callSid: string;
  phone: string;
  config: VoiceBotConfig;
  publicBaseUrl: string;
  step: DemoStep;
  verificationTarget?: VerificationTarget;
  service?: VoiceBotServiceDefinition;
  preference?: DatePreference;
  offeredSlots?: OfferedSlot[];
  selectedSlot?: OfferedSlot;
  firstName?: string;
  lastName?: string;
  acceptedTerms?: boolean;
  forceDtmf?: boolean;
  expiresAt: number;
}

const sessions = new Map<string, DemoSession>();

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
  const session: DemoSession = { callSid, phone, config, publicBaseUrl: baseUrl, step: 'service', expiresAt: Date.now() + SESSION_TTL_MS };
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

function verificationText(session: DemoSession): string {
  switch (session.verificationTarget) {
    case 'service': return `Ďakujem. Rozumela som správne, že sa chcete objednať na ${session.service?.label}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'date_preference': return `Ďakujem. Rozumela som správne, že preferujete ${session.preference?.timeOfDay === 'morning' ? 'termín dopoludnia' : session.preference?.timeOfDay === 'afternoon' ? 'termín popoludní' : 'najbližší voľný termín'}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'slot': return `Ďakujem. Rozumela som správne, že vám vyhovuje ${session.selectedSlot ? formatSlot(session.selectedSlot) : 'tento termín'}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    case 'name': return `Rozumela som správne, že sa voláte ${session.firstName} ${session.lastName}? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.`;
    default: return 'Rozumela som vám správne? Povedzte áno alebo stlačte 1. Pre nie stlačte 2.';
  }
}

function ask(reply: FastifyReply, session: DemoSession, message: string, hints = '', forceDtmf = false): FastifyReply {
  save(session);
  const twiml = new VoiceResponse();
  const expectsSingleDigit = session.step !== 'name';
  const gather = twiml.gather({
    input: forceDtmf ? ['dtmf'] : ['speech', 'dtmf'],
    action: `/voice/demo/${session.config.id}/answer`, method: 'POST', timeout: 5, speechTimeout: 'auto', language: 'sk-SK', hints,
    ...(expectsSingleDigit ? { numDigits: 1 } : {}),
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
      const options = session.config.services.map((service, index) => `Pre ${service.label} stlačte ${index + 1}${forceDtmf ? '.' : ` alebo povedzte ${service.voiceAliases[0] || service.label}.`}`).join(' ');
      return ask(reply, session, `${prefix}${keyboard}${options}`, session.config.services.flatMap((service) => [service.label, ...service.voiceAliases]).join(', '), forceDtmf);
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
        if (session.config.conversation.confirmService) beginVerification(session, 'service');
        else session.step = 'date_preference';
        return prompt(reply, session, session.config.conversation.confirmService ? '' : 'Ďakujem. Poďme teraz spoločne vybrať termín, ktorý by vám vyhovoval. ');
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
}
