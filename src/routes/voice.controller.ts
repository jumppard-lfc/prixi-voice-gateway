import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';
import { prixiService } from '../services/prixi.service';
import { sttService } from '../services/stt.service';
import { ivrService } from '../services/ivr.service';
import { CallForwardedEvent, VoicemailRecordedEvent } from '../types';
import { claimVoiceEvent, completeVoiceEvent, failVoiceEvent, createVoiceEventKey } from '../utils/voice-event-ledger';

const VoiceResponse = twilio.twiml.VoiceResponse;

export async function voiceRoutes(fastify: FastifyInstance) {

  fastify.post('/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const fromNumber = body.From;
    fastify.log.info({ from: fromNumber }, 'Incoming voice call received');

    const twiml = new VoiceResponse();

    try {
      const config = await prixiService.getConfig(fromNumber);

      if (!ivrService.shouldAllowCall(config)) {
        twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Toto číslo je momentálne nedostupné.');
        twiml.reject();
        return reply.type('text/xml').send(twiml.toString());
      }

      if (ivrService.isLiveCallWindow(config.timezone)) {
        twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Prepájam vás do ambulancie, prosím čakajte na linke.');
        twiml.dial('+421940610160');
        return reply.type('text/xml').send(twiml.toString());
      }

      twiml.say(
        { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
        'Dobrý deň, som digitálna sestra PriXi v ambulancii všeobecného lekára Slovenský Grob. Ak ste akútne chorý, príďte na vyšetrenie bez objednania počas ordinačných hodín, ktoré nájdete na webe ambulancie www.medisim.sk. Taktiež web ambulancie slúži na objednanie na preventívnu prehliadku, žiadosti o recept alebo vystavenie potvrdení a podobne. Prosíme, uprednostnite možnosť komunikácie cez webovú stránku www.medisim.sk. Ak si prajete ponechať telefonický odkaz, popíšte prosím po zaznení tónu najprv váš problém a po skončení stlačte hociktoré tlačidlo.'
      );
      twiml.record({
        action: '/voice/record-problem',
        playBeep: true,
        maxLength: 120,
        timeout: 4
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
    const problemUrl = body.RecordingUrl;
    const problemDuration = body.RecordingDuration || '0';

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Ďakujem. Teraz prosím uveďte vaše meno a priezvisko, a po skončení stlačte hociktoré tlačidlo.');
    twiml.record({
      action: `/voice/record-name?problemUrl=${encodeURIComponent(problemUrl || '')}&problemDuration=${problemDuration}`,
      playBeep: true,
      maxLength: 10,
      timeout: 2
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

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Rozumiem. Na záver prosím uveďte váš rok narodenia a stlačte hociktoré tlačidlo.');
    twiml.record({
      action: `/voice/recording-complete?problemUrl=${encodeURIComponent(problemUrl)}&problemDuration=${problemDuration}&nameUrl=${encodeURIComponent(nameUrl || '')}&nameDuration=${nameDuration}`,
      playBeep: true,
      maxLength: 5,
      timeout: 2
    });

    return reply.type('text/xml').send(twiml.toString());
  });

  async function handleVoicemailBackground(
    fromNumber: string,
    nameUrl: string,
    birthYearUrl: string,
    problemUrl: string,
    durationSeconds: number,
    callStartedAt: string,
    callEndedAt: string,
    providerCallId: string,
    eventKey: string
  ) {
    if (!claimVoiceEvent(eventKey)) {
      fastify.log.info({ providerCallId }, 'Duplicate voicemail webhook ignored in background');
      return;
    }

    try {
      const config = await prixiService.getConfig(fromNumber);

      try {
        const [nameTranscript, birthYearTranscript, problemTranscript] = await Promise.all([
          nameUrl
            ? sttService.transcribeAudioUrl(nameUrl, 'Meno a priezvisko pacienta, napríklad Ján Kováč, Mária Nováková.')
            : Promise.resolve(''),
          birthYearUrl
            ? sttService.transcribeAudioUrl(birthYearUrl, 'Rok narodenia pacienta vo formáte 4-miestneho čísla, napríklad 1985, 1990, 2003, 1952. Nevymýšľaj si webové stránky ani vety, uveď len číslo.')
            : Promise.resolve(''),
          problemUrl
            ? sttService.transcribeAudioUrl(problemUrl, 'Popis zdravotného problému pacienta pre lekára. Napríklad bolesť chrbta, recept na lieky, kašeľ, teplota. Alebo sa len jednoducho chce objednať na termín, alebo sa zaujíma o výsledky z vyšetrenia, a pod.')
            : Promise.resolve('')
        ]);

        const event: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
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

    const fromNumber = body.From;
    const providerCallId = body.CallSid;

    const nameDuration = parseInt(query.nameDuration || '0', 10);
    const problemDuration = parseInt(query.problemDuration || '0', 10);
    const birthYearDuration = parseInt(body.RecordingDuration || '0', 10);
    const durationSeconds = nameDuration + birthYearDuration + problemDuration;

    // Rough estimation if exact start/end differ
    const callStartedAt = new Date(Date.now() - durationSeconds * 1000).toISOString();
    const callEndedAt = new Date().toISOString();

    fastify.log.info({ from: fromNumber, durationSeconds, problemUrl }, 'Voicemail recording complete');

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Rozumiem, vaša požiadavka je zaznamenaná, ambulancia sa vám po jej prijatí ozve. Ďakujeme a dovidenia.');
    twiml.hangup();

    // Return XML to Twilio immediately to prevent timeouts
    reply.type('text/xml').send(twiml.toString());

    if (problemUrl || nameUrl || birthYearUrl) {
      const eventKey = createVoiceEventKey('voicemail_recorded', providerCallId);
      // Run heavy processing asynchronously in background
      handleVoicemailBackground(fromNumber, nameUrl, birthYearUrl, problemUrl, durationSeconds, callStartedAt, callEndedAt, providerCallId, eventKey)
        .catch(err => fastify.log.error(err, 'Background voicemail task failed'));
    }
  });
}
