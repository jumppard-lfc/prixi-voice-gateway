import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { prixiService } from '../services/prixi.service';
import { sttService } from '../services/stt.service';
import { ivrService } from '../services/ivr.service';
import { bulkGateSmsService } from '../services/bulkgate-sms.service';
import { getCelkovaTimeMessage } from '../services/pediatric-call-context.service';
import { CallForwardedEvent, ClinicConfig, VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, failVoiceEvent, createVoiceEventKey } from '../utils/voice-event-ledger';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { voiceBotConfigStore } from '../services/voice-bot-config.store';
import { normalizeBirthYearTranscript } from '../utils/transcript-normalization';
import { getVoicemailDraft, updateVoicemailDraft, VoicemailDraft } from '../utils/voicemail-draft-store';
import { finalizeAbandonedVadkertiCall, startVadkertiVoiceBot } from './vadkerti-voice-bot.controller';
import { vadkertiBotConfig } from '../config/vadkerti.config';
import { finalizeAbandonedNeurocentrumCall, startNeurocentrumVoiceBot } from './neurocentrum-voice-bot.controller';
import { neurocentrumBotConfig } from '../config/neurocentrum.config';
import { neurocentrumEdsService } from '../services/neurocentrum-eds.service';
import { finalizeAbandonedDemoCall } from './demo-voice-bot.controller';

const VoiceResponse = twilio.twiml.VoiceResponse;

const CELKOVA_PHONE_NUMBER = '+420910927082';
const CELKOVA_CLINIC_ID = '142';
const BENOVA_BALOGHOVA_PHONE_NUMBER = '+420910927739';
const BENOVA_BALOGHOVA_CLINIC_ID = '143';
const KLOSTERMANN_PHONE_NUMBER = '+420910924239';
const NOVOTNY_PHONE_NUMBER = '+420910928021';
const NOVOTNY_CLINIC_ID = '112';
const HMIRA_PHONE_NUMBER = '+420910924407';
const HMIRA_ROUTING_PHONE_NUMBER = '+421948834475';
const HMIRA_CLINIC_ID = '151';
const ZDRAHALOVA_PHONE_NUMBER = '+420910926126';
const ZDRAHALOVA_ROUTING_PHONE_NUMBER = '+421911135193';
const ZDRAHALOVA_CLINIC_ID = '152';
const POPRAD_ONCOLOGY_PHONE_NUMBER = '+420910925584';
const POPRAD_ONCOLOGY_CLINIC_ID = '154';
const POPRAD_ONCOLOGY_ROUTING_PHONE_NUMBERS = new Set([
  '+421524314169',
  '+421524314171',
  '+421524314172',
  '+421524314174',
]);
const DOBROVODSKA_ROUTING_PHONE_NUMBER = '+421911500609';
const DOBROVODSKA_CLINIC_ID = '95';
const PEKARCIK_VIPTEL_PHONE_NUMBER = '+421332289010';
const PEKARCIK_ROUTING_PHONE_NUMBER = '+421940610160';
const PEKARCIK_CLINIC_ID = '64';
const VADKERTI_TWILIO_PHONE_NUMBER = vadkertiBotConfig.clinic.inboundTwilioNumber;
const VADKERTI_ROUTING_PHONE_NUMBER = '+421902647072';
const NEUROCENTRUM_ROUTING_PHONE_NUMBER = neurocentrumBotConfig.clinic.routingPhoneNumber;
const UNRESOLVED_CLINIC_IDS = new Set(['', 'orphan', 'fallback', 'local-dev']);
const KLOSTERMANN_SK_GREETING = 'Dobrý deň, dovolali ste sa do Ortodoncia Klostermann. Aby ste nemuseli čakať, posielame Vám SMS správu s odkazom na objednanie. Ďakujeme.';
const KLOSTERMANN_EN_GREETING = 'Hello, you have reached Klostermann Orthodontics. So that you don’t have to wait, we will send you an SMS with a link to order. Thank you.';
const KLOSTERMANN_SMS = 'Dobry den, pre objednanie do ambulancie kliknite na klostermann.sk/rezervacia\n\nHello, to make an appointment for the clinic, click on klostermann.sk/rezervacia';
const KLOSTERMANN_GREETING_MEDIA_PATH = '/media/klostermann-greeting-v5.wav';
const KLOSTERMANN_GREETING_FILE = resolve(__dirname, '../assets/audio/klostermann-greeting-v5.wav');
const DOBROVODSKA_GREETING_FILE = resolve(__dirname, '../assets/audio/dobrovodska-1-greeting-v2.wav');
const DOBROVODSKA_COMPLETION_FILE = resolve(__dirname, '../assets/audio/dobrovodska-2-completion-v2.wav');
const HMIRA_GREETING_FILE = resolve(__dirname, '../assets/audio/hmira-1-greeting-v1.wav');
const HMIRA_COMPLETION_FILE = resolve(__dirname, '../assets/audio/hmira-2-completion-v1.wav');

function getPublicBaseUrl(request: FastifyRequest): string {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  return (process.env.PUBLIC_BASE_URL || `${forwardedProto}://${forwardedHost}`).replace(/\/$/, '');
}

function isDobrovodskaRoute(phone?: string): boolean {
  if (!phone) return false;
  const norm = normalizeSlovakPhoneAddress(phone);
  return norm === DOBROVODSKA_ROUTING_PHONE_NUMBER
    || norm === '+421322289055'
    || norm === '+421800232793'
    || phone.includes('322289055')
    || phone.includes('800232793');
}
const DEFAULT_GREETING = 'Dobrý deň, dovolali ste sa do ambulancie. Pre zanechanie odkazu popíšte po zaznení tónu najprv váš problém a po skončení stlačte hociktoré tlačidlo.';
const PEDIATRIC_GREETING = 'Dobrý deň, dovolali ste sa do pediatrickej ambulancie doktorky Čelkovej. Ak ide o náhly život ohrozujúci stav, volajte tiesňovú linku 155 alebo 112. V opačnom prípade nám prosím po zaznení tónu stručne povedzte, s čím sa na ambulanciu obraciate. Môže ísť napríklad o zdravotné ťažkosti dieťaťa, predpis liekov, výsledky vyšetrenia alebo objednanie. Po skončení stlačte ľubovoľné tlačidlo.';
const ORTHOPEDIC_GREETING = 'Dobrý deň, dovolali ste sa do ortopedickej ambulancie pani doktorky Miroslavy Beňovej Baloghovej. Po zaznení tónu nám, prosím, povedzte, s čím vám môžeme pomôcť. Po skončení stlačte ľubovoľné tlačidlo.';
const NOVOTNY_DENTAL_GREETING = 'Prepáčte za zdržanie. Tu je virtuálna sestra PriXi z ambulancie doktora Novotného. Povedzte mi, prosím, svoje meno a s čím vám môžem pomôcť.';
const NOVOTNY_DENTAL_COMPLETION = 'Rozumiem. Vašu požiadavku odovzdám doktorovi Novotnému a ozveme sa vám späť do 24 hodín. Ďakujem a dovidenia.';
const HMIRA_DENTAL_GREETING = 'Prepáčte za zdržanie. Tu je virtuálna sestra PriXi z ambulancie doktora Hmiru. Povedzte mi, prosím, svoje meno a s čím vám môžem pomôcť.';
const HMIRA_DENTAL_COMPLETION = 'Rozumiem. Vašu požiadavku odovzdám doktorovi Hmirovi a ozveme sa vám späť do 24 hodín. Ďakujem a dovidenia.';
const ZDRAHALOVA_PEDIATRIC_GREETING = 'Dobrý deň, tu je virtuálna sestra PriXi z ambulancie doktorky Zdráhalovej. Povedzte mi, prosím, meno dieťaťa a s čím vám môžeme pomôcť.';
const ZDRAHALOVA_PEDIATRIC_COMPLETION = 'Ďakujem. Vašu požiadavku odovzdám ambulancii doktorky Zdráhalovej a ozveme sa vám späť. Dovidenia.';
const POPRAD_ONCOLOGY_GREETING = 'Dobrý deň, tu je virtuálna sestra PriXi z oddelenia klinickej onkológie v Poprade. Povedzte mi prosím svoje meno a s čím vám môžeme pomôcť.';
const POPRAD_ONCOLOGY_COMPLETION = 'Ďakujem. Vašu požiadavku odovzdám oddeleniu klinickej onkológie a ozveme sa vám späť. Dovidenia.';
const PROTECTED_PRODUCTION_TWILIO_NUMBERS = new Set([
  CELKOVA_PHONE_NUMBER,
  BENOVA_BALOGHOVA_PHONE_NUMBER,
  KLOSTERMANN_PHONE_NUMBER,
  NOVOTNY_PHONE_NUMBER,
  HMIRA_PHONE_NUMBER,
  HMIRA_ROUTING_PHONE_NUMBER,
  ZDRAHALOVA_PHONE_NUMBER,
  ZDRAHALOVA_ROUTING_PHONE_NUMBER,
  POPRAD_ONCOLOGY_PHONE_NUMBER,
  ...POPRAD_ONCOLOGY_ROUTING_PHONE_NUMBERS,
  PEKARCIK_VIPTEL_PHONE_NUMBER,
  PEKARCIK_ROUTING_PHONE_NUMBER,
  DOBROVODSKA_ROUTING_PHONE_NUMBER,
  VADKERTI_TWILIO_PHONE_NUMBER,
  VADKERTI_ROUTING_PHONE_NUMBER,
  NEUROCENTRUM_ROUTING_PHONE_NUMBER,
  '+421800232793',
].filter(Boolean));

function getNovotnyVoiceBotPhoneNumber(): string {
  return process.env.NOVOTNY_VOICE_BOT_PHONE_NUMBER?.trim() || NOVOTNY_PHONE_NUMBER;
}

function normalizeSlovakPhoneAddress(value?: string): string {
  if (!value) return '';

  const address = value.trim().replace(/^sip:/i, '').split('@')[0].split(';')[0];
  const digits = address.replace(/\D/g, '');

  if (digits.startsWith('00421')) return `+421${digits.slice(5)}`;
  if (digits.startsWith('421')) return `+${digits}`;
  if (digits.startsWith('0')) return `+421${digits.slice(1)}`;

  return address;
}

function isHmiraRoute(value?: string): boolean {
  const normalizedValue = normalizeSlovakPhoneAddress(value);
  return normalizedValue === HMIRA_PHONE_NUMBER || normalizedValue === HMIRA_ROUTING_PHONE_NUMBER;
}

function isZdrahalovaRoute(value?: string): boolean {
  const normalizedValue = normalizeSlovakPhoneAddress(value);
  return normalizedValue === ZDRAHALOVA_PHONE_NUMBER
    || normalizedValue === ZDRAHALOVA_ROUTING_PHONE_NUMBER;
}

function isPopradOncologyRoute(value?: string): boolean {
  const normalizedValue = normalizeSlovakPhoneAddress(value);
  return normalizedValue === POPRAD_ONCOLOGY_PHONE_NUMBER
    || POPRAD_ONCOLOGY_ROUTING_PHONE_NUMBERS.has(normalizedValue);
}

function getDentalCompletion(routingPhoneNumber: string): string {
  return isHmiraRoute(routingPhoneNumber) ? HMIRA_DENTAL_COMPLETION : NOVOTNY_DENTAL_COMPLETION;
}

function assertClinicRoutingIsolation(
  config: ClinicConfig,
  routingPhoneNumber: string,
  novotnyVoiceBotPhoneNumber: string = getNovotnyVoiceBotPhoneNumber()
): void {
  const clinicId = String(config.clinicId ?? '').trim();

  if (!routingPhoneNumber || UNRESOLVED_CLINIC_IDS.has(clinicId.toLowerCase())) {
    throw new Error(
      `Blocked unresolved voice route: route ${routingPhoneNumber || '<missing>'} resolved to clinic ${clinicId || '<missing>'}`
    );
  }

  const normalizedRoute = normalizeSlovakPhoneAddress(routingPhoneNumber);
  const protectedRoutes = new Map<string, string>([
    [PEKARCIK_ROUTING_PHONE_NUMBER, PEKARCIK_CLINIC_ID],
    [DOBROVODSKA_ROUTING_PHONE_NUMBER, DOBROVODSKA_CLINIC_ID],
    [CELKOVA_PHONE_NUMBER, CELKOVA_CLINIC_ID],
    [BENOVA_BALOGHOVA_PHONE_NUMBER, BENOVA_BALOGHOVA_CLINIC_ID],
    [novotnyVoiceBotPhoneNumber, NOVOTNY_CLINIC_ID],
    [HMIRA_PHONE_NUMBER, HMIRA_CLINIC_ID],
    [HMIRA_ROUTING_PHONE_NUMBER, HMIRA_CLINIC_ID],
    [ZDRAHALOVA_PHONE_NUMBER, ZDRAHALOVA_CLINIC_ID],
    [ZDRAHALOVA_ROUTING_PHONE_NUMBER, ZDRAHALOVA_CLINIC_ID],
    [POPRAD_ONCOLOGY_PHONE_NUMBER, POPRAD_ONCOLOGY_CLINIC_ID],
    ...Array.from(POPRAD_ONCOLOGY_ROUTING_PHONE_NUMBERS, phoneNumber => [phoneNumber, POPRAD_ONCOLOGY_CLINIC_ID] as [string, string]),
  ]);
  const expectedClinicId = protectedRoutes.get(normalizedRoute);
  const protectedClinicIds = new Set(protectedRoutes.values());

  if (
    (expectedClinicId && clinicId !== expectedClinicId)
    || (!expectedClinicId && protectedClinicIds.has(clinicId))
  ) {
    throw new Error(
      `Blocked cross-clinic voice event: route ${routingPhoneNumber || '<missing>'} resolved to clinic ${config.clinicId}`
    );
  }
}

export async function voiceRoutes(fastify: FastifyInstance) {

  function parseRecordingDuration(value?: string): number {
    const duration = Number.parseInt(value || '0', 10);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function dispatchVoicemail(params: {
    fromNumber: string;
    forwardedFrom: string;
    nameUrl?: string;
    birthYearUrl?: string;
    problemUrl?: string;
    nameDuration?: string;
    birthYearDuration?: string;
    problemDuration?: string;
    providerCallId: string;
    pediatricMode: boolean;
    dentalMode: boolean;
    requireProblem?: boolean;
    callStartedAt?: string;
    callEndedAt?: string;
  }): void {
    const nameUrl = params.nameUrl || '';
    const birthYearUrl = params.birthYearUrl || '';
    const problemUrl = params.problemUrl || '';

    // A request becomes useful only after the problem step has produced a
    // recording. Name and birth year may legitimately remain empty.
    if ((params.requireProblem && !problemUrl) || (!problemUrl && !nameUrl && !birthYearUrl)) return;

    const durationSeconds = parseRecordingDuration(params.nameDuration)
      + parseRecordingDuration(params.birthYearDuration)
      + parseRecordingDuration(params.problemDuration);
    const callEndedAt = params.callEndedAt || new Date().toISOString();
    const callStartedAt = params.callStartedAt
      || new Date(Date.now() - durationSeconds * 1000).toISOString();
    const eventKey = createVoiceEventKey('voicemail_recorded', params.providerCallId);

    handleVoicemailBackground(
      params.fromNumber,
      params.forwardedFrom,
      nameUrl,
      birthYearUrl,
      problemUrl,
      durationSeconds,
      callStartedAt,
      callEndedAt,
      params.providerCallId,
      eventKey,
      params.pediatricMode,
      params.dentalMode
    ).catch(err => fastify.log.error(err, 'Background voicemail task failed'));
  }

  function dispatchDraft(draft: VoicemailDraft): void {
    dispatchVoicemail({
      fromNumber: draft.fromNumber,
      forwardedFrom: draft.forwardedFrom,
      nameUrl: draft.nameUrl,
      birthYearUrl: draft.birthYearUrl,
      problemUrl: draft.problemUrl,
      nameDuration: draft.nameDuration,
      birthYearDuration: draft.birthYearDuration,
      problemDuration: draft.problemDuration,
      providerCallId: draft.callSid,
      pediatricMode: draft.pediatricMode,
      dentalMode: draft.dentalMode,
      requireProblem: true,
      callStartedAt: draft.callStartedAt,
      callEndedAt: draft.callEndedAt,
    });
  }

  fastify.post('/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const fromNumber = body.From;
    const carrierForwardedFrom = body.ForwardedFrom;
    let forwardedFrom = body.ForwardedFrom;
    const novotnyVoiceBotPhoneNumber = getNovotnyVoiceBotPhoneNumber();
    const normalizedTo = normalizeSlovakPhoneAddress(body.To);
    const normalizedCarrierForwardedFrom = normalizeSlovakPhoneAddress(carrierForwardedFrom);
    const isPekarcikVipTelDestination = normalizedTo === PEKARCIK_VIPTEL_PHONE_NUMBER;
    const isHmiraDedicatedDestination = normalizedTo === HMIRA_PHONE_NUMBER;
    const isPopradOncologyDestination = isPopradOncologyRoute(body.To);
    const isOtherDedicatedDestination = normalizedTo === CELKOVA_PHONE_NUMBER
      || normalizedTo === BENOVA_BALOGHOVA_PHONE_NUMBER
      || normalizedTo === normalizeSlovakPhoneAddress(novotnyVoiceBotPhoneNumber)
      || isZdrahalovaRoute(body.To)
      || isHmiraDedicatedDestination
      || isHmiraRoute(body.To)
      || isPopradOncologyDestination;

    const isExistingDedicatedDestination = isPekarcikVipTelDestination
      || normalizedTo === CELKOVA_PHONE_NUMBER
      || normalizedTo === BENOVA_BALOGHOVA_PHONE_NUMBER
      || normalizedTo === KLOSTERMANN_PHONE_NUMBER
      || normalizedTo === normalizeSlovakPhoneAddress(novotnyVoiceBotPhoneNumber)
      || isZdrahalovaRoute(body.To)
      || isHmiraDedicatedDestination
      || isHmiraRoute(body.To)
      || isPopradOncologyDestination
      || normalizedTo === NEUROCENTRUM_ROUTING_PHONE_NUMBER
      || isDobrovodskaRoute(body.To);
    const isNeurocentrumCall = (!isExistingDedicatedDestination && normalizedCarrierForwardedFrom === NEUROCENTRUM_ROUTING_PHONE_NUMBER)
      || normalizedTo === NEUROCENTRUM_ROUTING_PHONE_NUMBER;

    if (isNeurocentrumCall) {
      fastify.log.info({ from: fromNumber, to: body.To, forwardedFrom: carrierForwardedFrom }, 'Routing call to Neurocentrum production voice bot');
      // ForwardedFrom identifies the clinic line, while EDS stores the voice
      // assistant configuration under the destination Twilio DID.
      return startNeurocentrumVoiceBot(fastify, reply, body, normalizedTo || NEUROCENTRUM_ROUTING_PHONE_NUMBER);
    }

    const isVadkertiDedicatedDestination = normalizedTo === VADKERTI_TWILIO_PHONE_NUMBER;
    const isVadkertiCall = isVadkertiDedicatedDestination
      || (!isExistingDedicatedDestination && normalizedCarrierForwardedFrom === VADKERTI_ROUTING_PHONE_NUMBER)
      || normalizedTo === VADKERTI_ROUTING_PHONE_NUMBER;

    if (isVadkertiCall) {
      fastify.log.info({ from: fromNumber, to: body.To, forwardedFrom: carrierForwardedFrom }, 'Routing call to MUDr. Vadkerti production voice bot');
      return startVadkertiVoiceBot(reply, body);
    }

    // Klostermann's carrier forwards an unanswered call from the clinic mobile
    // to this dedicated bot number after approximately 15 seconds.
    // An explicit dedicated destination always wins over a conflicting carrier
    // ForwardedFrom header, so one clinic can never capture another clinic's DID.
    const isKlostermannCall = body.To === KLOSTERMANN_PHONE_NUMBER
      || (!isPekarcikVipTelDestination
        && !isOtherDedicatedDestination
        && body.ForwardedFrom === KLOSTERMANN_PHONE_NUMBER);

    if (isKlostermannCall) {
      fastify.log.info({ from: fromNumber, to: body.To, forwardedFrom: body.ForwardedFrom }, 'Handling unanswered Klostermann call');
      const twiml = new VoiceResponse();
      if (existsSync(KLOSTERMANN_GREETING_FILE)) {
        const forwardedProto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
        const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${forwardedProto}://${forwardedHost}`).replace(/\/$/, '');
        twiml.play(`${publicBaseUrl}${KLOSTERMANN_GREETING_MEDIA_PATH}`);
      } else {
        fastify.log.error({ path: KLOSTERMANN_GREETING_FILE }, 'Klostermann greeting file is missing; using TTS fallback');
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-B' as any },
          KLOSTERMANN_SK_GREETING
        );
        twiml.say(
          { language: 'en-GB', voice: 'Google.en-GB-Wavenet-A' as any },
          KLOSTERMANN_EN_GREETING
        );
      }

      if (process.env.NODE_ENV !== 'test') {
        bulkGateSmsService.sendTransactionalSms(fromNumber, KLOSTERMANN_SMS).then(result => {
          fastify.log.info({ messageId: result.messageId, status: result.status, to: fromNumber }, 'Klostermann booking SMS accepted by BulkGate');
        }).catch(err => {
          const error = err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
          fastify.log.error({ err: error, to: fromNumber }, 'Failed to send Klostermann booking SMS through BulkGate');
        });
      }

      twiml.hangup();
      return reply.type('text/xml').send(twiml.toString());
    }

    // New bots may be reached through the shared incoming webhook only when
    // Twilio's destination number exactly matches a number saved in that bot's
    // configuration. All existing production numbers remain on their current
    // fine-tuning flow, even if a configuration is saved incorrectly.
    const normalizedDedicatedNumber = normalizeSlovakPhoneAddress(body.To);
    const isProtectedProductionNumber = PROTECTED_PRODUCTION_TWILIO_NUMBERS.has(normalizedDedicatedNumber)
      || normalizedDedicatedNumber === normalizeSlovakPhoneAddress(novotnyVoiceBotPhoneNumber);
    if (body.To && !isProtectedProductionNumber) {
      const dedicatedDemoBot = await voiceBotConfigStore.findByInboundTwilioNumber(body.To);
      if (dedicatedDemoBot?.provider.mode === 'demo_mock') {
        fastify.log.info({ botId: dedicatedDemoBot.id, to: body.To }, 'Routing dedicated Twilio number to configured demo voice bot');
        const twiml = new VoiceResponse();
        twiml.redirect(`/voice/demo/${dedicatedDemoBot.id}/start`);
        return reply.type('text/xml').send(twiml.toString());
      }

      // EDS owns new production DID assignments. This lookup runs only after
      // every existing production and demo route, and only for direct calls
      // without a carrier ForwardedFrom value, so legacy customer routing is
      // not delayed or reinterpreted.
      if (!carrierForwardedFrom) {
        try {
          const resolvedConfig = await neurocentrumEdsService.resolveByInboundPhoneNumber(normalizedTo);
          if (resolvedConfig) {
            fastify.log.info(
              { clinicId: resolvedConfig.clinicId, assistantType: resolvedConfig.assistantType, to: normalizedTo },
              'Routing database-assigned Twilio number to production voice bot'
            );
            return startNeurocentrumVoiceBot(fastify, reply, body, normalizedTo);
          }
        } catch (error) {
          fastify.log.error(
            { err: error, to: body.To },
            'Failed to resolve an unrecognised direct Twilio number through EDS'
          );
        }
      }
    }

    // Dedicated Twilio numbers are authoritative routing keys. Carrier-provided
    // ForwardedFrom identifies the forwarding line, not the destination clinic.
    if (body.To === CELKOVA_PHONE_NUMBER) {
      forwardedFrom = CELKOVA_PHONE_NUMBER;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied dedicated Twilio number routing for MUDr. Celkova');
    } else if (body.To === BENOVA_BALOGHOVA_PHONE_NUMBER) {
      forwardedFrom = BENOVA_BALOGHOVA_PHONE_NUMBER;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied dedicated Twilio number routing for MUDr. Benova Baloghova');
    } else if (novotnyVoiceBotPhoneNumber && body.To === novotnyVoiceBotPhoneNumber) {
      forwardedFrom = novotnyVoiceBotPhoneNumber;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied dedicated Twilio number routing for MUDr. Novotny');
    } else if (
      isZdrahalovaRoute(body.To)
      || (!isOtherDedicatedDestination && isZdrahalovaRoute(carrierForwardedFrom))
    ) {
      forwardedFrom = ZDRAHALOVA_ROUTING_PHONE_NUMBER;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied routing for MUDr. Zora Zdrahalova');
    } else if (
      isHmiraDedicatedDestination
      || isHmiraRoute(body.To)
      || isHmiraRoute(carrierForwardedFrom)
    ) {
      forwardedFrom = HMIRA_PHONE_NUMBER;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied routing for MDDr. Milos Hmira');
    } else if (
      isPopradOncologyDestination
      || (!isExistingDedicatedDestination && isPopradOncologyRoute(carrierForwardedFrom))
    ) {
      forwardedFrom = POPRAD_ONCOLOGY_PHONE_NUMBER;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied routing for Poprad clinical oncology department');
    } else if (
      isPekarcikVipTelDestination
      || normalizedCarrierForwardedFrom === PEKARCIK_VIPTEL_PHONE_NUMBER
      || normalizedCarrierForwardedFrom === PEKARCIK_ROUTING_PHONE_NUMBER
    ) {
      forwardedFrom = PEKARCIK_ROUTING_PHONE_NUMBER;
      fastify.log.info({ from: fromNumber, to: body.To, carrierForwardedFrom }, 'Applied dedicated VipTel routing for Martin Pekarcik');
    } else if (isDobrovodskaRoute(body.To) || isDobrovodskaRoute(carrierForwardedFrom) || isDobrovodskaRoute(forwardedFrom) || !forwardedFrom) {
      if (isDobrovodskaRoute(body.To) || isDobrovodskaRoute(carrierForwardedFrom) || isDobrovodskaRoute(forwardedFrom)) {
        forwardedFrom = DOBROVODSKA_ROUTING_PHONE_NUMBER; // Hardcoded fallback for MUDr. Dobrovodska
        fastify.log.info({ from: fromNumber, to: body.To }, 'Applied hardcoded ForwardedFrom fallback for Dobrovodska');
      } else {
        fastify.log.error({ from: fromNumber, to: body.To }, '[CRITICAL ALERT] Missing ForwardedFrom header! The SIP Diversion header was dropped by the carrier. Routing cannot reliably identify the clinic.');
        forwardedFrom = '';
      }
    }

    fastify.log.info({ from: fromNumber, forwardedFrom }, 'Incoming voice call received');

    const twiml = new VoiceResponse();

    if (!forwardedFrom) {
      twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Toto číslo je momentálne nedostupné.');
      twiml.reject();
      return reply.type('text/xml').send(twiml.toString());
    }

    try {
      const config = await prixiService.getConfig(forwardedFrom || fromNumber);
      assertClinicRoutingIsolation(config, forwardedFrom, novotnyVoiceBotPhoneNumber);

      if (
        normalizeSlovakPhoneAddress(forwardedFrom) === PEKARCIK_ROUTING_PHONE_NUMBER
        && !config.greetingMessage?.trim()
      ) {
        throw new Error('Blocked Pekarcik voice route because its configured greeting is missing');
      }

      const isCelkovaNumber = forwardedFrom === CELKOVA_PHONE_NUMBER;
      const isBenovaBaloghovaNumber = forwardedFrom === BENOVA_BALOGHOVA_PHONE_NUMBER;
      const isNovotnyNumber = Boolean(novotnyVoiceBotPhoneNumber) && forwardedFrom === novotnyVoiceBotPhoneNumber;
      const isHmiraNumber = isHmiraRoute(forwardedFrom);
      const isZdrahalovaNumber = isZdrahalovaRoute(forwardedFrom);
      const isPopradOncologyNumber = isPopradOncologyRoute(forwardedFrom);
      const isDedicatedVoiceBotNumber = isCelkovaNumber || isBenovaBaloghovaNumber || isNovotnyNumber || isHmiraNumber || isZdrahalovaNumber || isPopradOncologyNumber;

      if (!isDedicatedVoiceBotNumber && !ivrService.shouldAllowCall(config, forwardedFrom)) {
        twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Toto číslo je momentálne nedostupné.');
        twiml.reject();
        return reply.type('text/xml').send(twiml.toString());
      }

      const isDobrovodskaNumber = isDobrovodskaRoute(forwardedFrom) || isDobrovodskaRoute(body.To) || isDobrovodskaRoute(carrierForwardedFrom);
      const pediatricMode = isCelkovaNumber || isZdrahalovaNumber || (!isBenovaBaloghovaNumber && !isNovotnyNumber && !isHmiraNumber && config.pediatricMode === true);
      const dentalMode = isNovotnyNumber || isHmiraNumber;
      const greeting = isZdrahalovaNumber
        ? ZDRAHALOVA_PEDIATRIC_GREETING
        : isPopradOncologyNumber
          ? POPRAD_ONCOLOGY_GREETING
          : config.greetingMessage
          || (isBenovaBaloghovaNumber
            ? ORTHOPEDIC_GREETING
            : isHmiraNumber
              ? HMIRA_DENTAL_GREETING
              : dentalMode
                ? NOVOTNY_DENTAL_GREETING
                : pediatricMode
                  ? PEDIATRIC_GREETING
                  : DEFAULT_GREETING);

      if (isDobrovodskaNumber && existsSync(DOBROVODSKA_GREETING_FILE)) {
        twiml.play(`${getPublicBaseUrl(request)}/media/dobrovodska-1-greeting-v2.wav`);
      } else if (isHmiraNumber && existsSync(HMIRA_GREETING_FILE)) {
        twiml.play(`${getPublicBaseUrl(request)}/media/hmira-1-greeting-v1.wav`);
      } else {
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
          greeting
        );
      }
      updateVoicemailDraft(body.CallSid, {
        fromNumber,
        forwardedFrom,
        pediatricMode,
        dentalMode,
      });
      twiml.record({
        action: `/voice/record-problem?forwardedFrom=${encodeURIComponent(forwardedFrom)}&pediatricMode=${pediatricMode}&dentalMode=${dentalMode}`,
        playBeep: true,
        maxLength: 120,
        timeout: dentalMode || isZdrahalovaNumber || isPopradOncologyNumber ? 3 : 10
      });

      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /incoming');
      twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Momentálne máme technické problémy.');
      twiml.reject();
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/record-problem', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;
    const problemUrl = body.RecordingUrl;
    const problemDuration = body.RecordingDuration || '0';
    const forwardedFrom = query.forwardedFrom || '';
    const pediatricMode = query.pediatricMode === 'true';
    const dentalMode = query.dentalMode === 'true';
    const draft = updateVoicemailDraft(body.CallSid, {
      fromNumber: body.From,
      forwardedFrom,
      pediatricMode,
      dentalMode,
      problemUrl: problemUrl || '',
      problemDuration,
    });

    const twiml = new VoiceResponse();
    if (body.Digits === 'hangup') {
      reply.type('text/xml').send(twiml.toString());
      const completedDraft = updateVoicemailDraft(body.CallSid, {
        callCompleted: true,
        callEndedAt: new Date().toISOString(),
      }) || draft;
      if (completedDraft) dispatchDraft(completedDraft);
      return;
    }

    const isDobrovodskaNumber = isDobrovodskaRoute(forwardedFrom);
    const isZdrahalovaNumber = isZdrahalovaRoute(forwardedFrom);
    const isPopradOncologyNumber = isPopradOncologyRoute(forwardedFrom);
    if (isDobrovodskaNumber || dentalMode || isZdrahalovaNumber || isPopradOncologyNumber) {
      const completedDraft = updateVoicemailDraft(body.CallSid, {
        callCompleted: true,
        callEndedAt: new Date().toISOString(),
      }) || draft;
      if (isDobrovodskaNumber && existsSync(DOBROVODSKA_COMPLETION_FILE)) {
        twiml.play(`${getPublicBaseUrl(request)}/media/dobrovodska-2-completion-v2.wav`);
      } else if (isHmiraRoute(forwardedFrom) && existsSync(HMIRA_COMPLETION_FILE)) {
        twiml.play(`${getPublicBaseUrl(request)}/media/hmira-2-completion-v1.wav`);
      } else {
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
          isDobrovodskaNumber
            ? 'Ďakujeme, vašu požiadavku sme zaznamenali. Ambulancia sa vám ozve najneskôr do 24 hodín. Dovidenia.'
            : isZdrahalovaNumber
              ? ZDRAHALOVA_PEDIATRIC_COMPLETION
              : isPopradOncologyNumber
                ? POPRAD_ONCOLOGY_COMPLETION
                : getDentalCompletion(forwardedFrom)
        );
      }
      twiml.hangup();
      reply.type('text/xml').send(twiml.toString());
      if (completedDraft) dispatchDraft(completedDraft);
      return;
    }

    if (draft?.callCompleted) dispatchDraft(draft);

    if (pediatricMode && !isDobrovodskaNumber) {
      twiml.say(
        { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
        getCelkovaTimeMessage()
      );
    }
    const namePrompt = pediatricMode
      ? 'Ďakujem. Teraz, prosím, uveďte meno a priezvisko dieťaťa, ktorého sa požiadavka týka. Po skončení stlačte ľubovoľné tlačidlo.'
      : 'Ďakujem. Teraz prosím uveďte vaše meno a priezvisko, a po skončení stlačte hociktoré tlačidlo.';
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, namePrompt);
    twiml.record({
      action: `/voice/record-name?problemUrl=${encodeURIComponent(problemUrl || '')}&problemDuration=${problemDuration}&forwardedFrom=${encodeURIComponent(forwardedFrom)}&pediatricMode=${pediatricMode}&dentalMode=${dentalMode}`,
      playBeep: true,
      maxLength: 20,
      timeout: 5
    });

    return reply.type('text/xml').send(twiml.toString());
  });

  fastify.post('/record-name', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;
    const nameUrl = body.RecordingUrl;
    const nameDuration = body.RecordingDuration || '0';
    const problemUrl = query.problemUrl || '';
    const problemDuration = query.problemDuration || '0';
    const forwardedFrom = query.forwardedFrom || '';
    const pediatricMode = query.pediatricMode === 'true';
    const dentalMode = query.dentalMode === 'true';
    const draft = updateVoicemailDraft(body.CallSid, {
      fromNumber: body.From,
      forwardedFrom,
      pediatricMode,
      dentalMode,
      problemUrl,
      problemDuration,
      nameUrl: nameUrl || '',
      nameDuration,
    });

    const twiml = new VoiceResponse();
    if (body.Digits === 'hangup') {
      reply.type('text/xml').send(twiml.toString());
      const completedDraft = updateVoicemailDraft(body.CallSid, {
        callCompleted: true,
        callEndedAt: new Date().toISOString(),
      }) || draft;
      if (completedDraft) dispatchDraft(completedDraft);
      return;
    }

    if (draft?.callCompleted) dispatchDraft(draft);

    const birthYearPrompt = pediatricMode
      ? 'Na záver, prosím, uveďte rok narodenia dieťaťa a stlačte ľubovoľné tlačidlo.'
      : 'Rozumiem. Na záver prosím uveďte váš rok narodenia a stlačte hociktoré tlačidlo.';
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, birthYearPrompt);
    twiml.record({
      action: `/voice/recording-complete?problemUrl=${encodeURIComponent(problemUrl)}&problemDuration=${problemDuration}&nameUrl=${encodeURIComponent(nameUrl || '')}&nameDuration=${nameDuration}&forwardedFrom=${encodeURIComponent(forwardedFrom)}&pediatricMode=${pediatricMode}&dentalMode=${dentalMode}`,
      playBeep: true,
      maxLength: 10,
      timeout: 5
    });

    return reply.type('text/xml').send(twiml.toString());
  });

  async function handleVoicemailBackground(
    fromNumber: string,
    forwardedFrom: string,
    nameUrl: string,
    birthYearUrl: string,
    problemUrl: string,
    durationSeconds: number,
    callStartedAt: string,
    callEndedAt: string,
    providerCallId: string,
    eventKey: string,
    pediatricMode: boolean,
    dentalMode: boolean
  ) {
    if (!claimVoiceEvent(eventKey)) {
      fastify.log.info({ providerCallId }, 'Duplicate voicemail webhook ignored in background');
      return;
    }

    try {
      const config = await prixiService.getConfig(forwardedFrom || fromNumber);
      assertClinicRoutingIsolation(config, forwardedFrom);

      try {
        const transcribeSafe = async (url: string, prompt: string) => {
          if (!url) return '';
          // Ensure URL ends with .mp3 to get the compressed format and avoid Twilio issues
          const finalUrl = url.includes('.mp3') || url.includes('.wav') ? url : `${url}.mp3`;
          try {
            return await sttService.transcribeAudioUrl(finalUrl, prompt);
          } catch (err) {
            fastify.log.error(err, `Transcription failed for URL: ${finalUrl}`);
            return ''; // Return empty string so other transcripts are not lost
          }
        };

        const [nameTranscript, rawBirthYearTranscript, problemTranscript] = await Promise.all([
          transcribeSafe(nameUrl, pediatricMode
            ? 'Krátka telefonická nahrávka v slovenčine. Volajúci uvádza meno a priezvisko dieťaťa.'
            : 'Krátka telefonická nahrávka v slovenčine. Volajúci uvádza meno a priezvisko pacienta.'),
          transcribeSafe(birthYearUrl, pediatricMode
            ? 'Krátka telefonická nahrávka v slovenčine. Volajúci uvádza rok narodenia dieťaťa.'
            : 'Krátka telefonická nahrávka v slovenčine. Volajúci uvádza rok narodenia pacienta.'),
          transcribeSafe(problemUrl, isDobrovodskaRoute(forwardedFrom)
            ? 'Telefonická požiadavka pacienta pre ambulanciu všeobecnej lekárky v češtine. Pacient môže uviesť svoje meno a následne zdravotnú alebo administratívnu požiadavku; zachovaj všetky údaje v prepise.'
            : isPopradOncologyRoute(forwardedFrom)
              ? 'Telefonická požiadavka pacienta pre oddelenie klinickej onkológie v slovenčine. Pacient môže na začiatku uviesť svoje meno; zachovaj všetky údaje v prepise.'
              : isZdrahalovaRoute(forwardedFrom)
                ? 'Telefonická požiadavka rodiča pre pediatrickú ambulanciu v slovenčine. Rodič môže uviesť meno dieťaťa a následne zdravotnú alebo administratívnu požiadavku; zachovaj všetky údaje v prepise.'
                : pediatricMode
                  ? 'Telefonická požiadavka rodiča pre pediatrickú ambulanciu v slovenčine.'
                  : dentalMode
                    ? 'Telefonická požiadavka pacienta pre zubnú ambulanciu v slovenčine. Pacient môže na začiatku uviesť svoje meno; zachovaj ho v prepise.'
                    : 'Telefonická požiadavka pacienta pre lekársku ambulanciu v slovenčine.')
        ]);
        const birthYearTranscript = normalizeBirthYearTranscript(rawBirthYearTranscript);

        const event: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          routingPhoneNumber: forwardedFrom,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          nameUrl,
          birthYearUrl,
          problemUrl,
          nameTranscript,
          birthYearTranscript,
          problemTranscript
        };

        await prixiService.sendEvent(event, 3, eventKey);
        completeVoiceEvent(eventKey);
      } catch (err) {
        fastify.log.error(err, 'STT processing failed, sending event without transcript');
        const fallbackEvent: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          routingPhoneNumber: forwardedFrom,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          nameUrl,
          birthYearUrl,
          problemUrl,
          nameTranscript: '',
          birthYearTranscript: '',
          problemTranscript: ''
        };

        try {
          await prixiService.sendEvent(fallbackEvent, 3, eventKey);
          completeVoiceEvent(eventKey);
        } catch (reportErr) {
          failVoiceEvent(eventKey);
          fastify.log.error(reportErr, 'Failed to report fallback voicemail event');
        }
      }

    } catch (err) {
      failVoiceEvent(eventKey);
      fastify.log.error(err, 'Failed to process recording complete');
    }
  }

  fastify.post('/recording-complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;

    const birthYearUrl = body.RecordingUrl;
    const nameUrl = query.nameUrl || '';
    const problemUrl = query.problemUrl || '';
    const forwardedFrom = query.forwardedFrom || '';
    const pediatricMode = query.pediatricMode === 'true';
    const dentalMode = query.dentalMode === 'true';

    const fromNumber = body.From;
    const providerCallId = body.CallSid;

    const nameDuration = query.nameDuration || '0';
    const problemDuration = query.problemDuration || '0';
    const birthYearDuration = body.RecordingDuration || '0';
    const draft = updateVoicemailDraft(providerCallId, {
      fromNumber,
      forwardedFrom,
      pediatricMode,
      dentalMode,
      problemUrl,
      problemDuration,
      nameUrl,
      nameDuration,
      birthYearUrl: birthYearUrl || '',
      birthYearDuration,
      callCompleted: true,
      callEndedAt: new Date().toISOString(),
    });

    fastify.log.info({ from: fromNumber, problemUrl }, 'Voicemail recording complete');

    const twiml = new VoiceResponse();
    const isDobrovodskaNumber = isDobrovodskaRoute(forwardedFrom);
    if (isDobrovodskaNumber && existsSync(DOBROVODSKA_COMPLETION_FILE)) {
      twiml.play(`${getPublicBaseUrl(request)}/media/dobrovodska-2-completion-v2.wav`);
    } else if (isHmiraRoute(forwardedFrom) && existsSync(HMIRA_COMPLETION_FILE)) {
      twiml.play(`${getPublicBaseUrl(request)}/media/hmira-2-completion-v1.wav`);
    } else {
      const completionMessage = pediatricMode
        ? 'Ďakujeme, vašu požiadavku sme zaznamenali. Ambulancia sa vám po jej spracovaní ozve na telefónne číslo, z ktorého voláte. Dovidenia.'
        : dentalMode
          ? getDentalCompletion(forwardedFrom)
          : 'Rozumiem, vaša požiadavka je zaznamenaná, ambulancia sa vám po jej prijatí ozve. Ďakujeme a dovidenia.';
      twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, completionMessage);
    }
    twiml.hangup();

    // Return XML to Twilio immediately to prevent timeouts
    reply.type('text/xml').send(twiml.toString());

    if (draft) dispatchDraft(draft);
  });

  fastify.post('/call-status', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const terminalStatuses = new Set(['completed', 'canceled', 'failed', 'busy', 'no-answer']);

    reply.code(204).send();

    if (!terminalStatuses.has(body.CallStatus) || !body.CallSid) return;

    const draft = updateVoicemailDraft(body.CallSid, {
      fromNumber: body.From || getVoicemailDraft(body.CallSid)?.fromNumber || '',
      callCompleted: true,
      callEndedAt: new Date().toISOString(),
    });

    if (draft?.problemUrl) {
      dispatchDraft(draft);
    }

    finalizeAbandonedVadkertiCall(fastify, body.CallSid, new Date().toISOString());
    finalizeAbandonedNeurocentrumCall(body.CallSid);
    finalizeAbandonedDemoCall(body.CallSid, body.CallStatus);
  });
}
