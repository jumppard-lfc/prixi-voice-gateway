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

      const isDuringHours = ivrService.isDuringOfficeHours(config);

      if (isDuringHours) {
        const gather = twiml.gather({
          numDigits: 1,
          action: '/voice/gather',
          timeout: 5
        });
        gather.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
          'Dobrý deň. Ak ide o urgentný stav, stlačte 1. V opačnom prípade po zaznení tónu povedzte svoje meno a popíšte svoj problém.'
        );

        // Timeout/No input -> fallback to voicemail (skipping the gather)
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
          'Prosím, po zaznení tónu povedzte svoje celé meno.'
        );
        twiml.record({
          action: '/voice/record-name',
          playBeep: true,
          maxLength: 10,
          timeout: 3
        });
      } else {
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
          'Dovolali ste sa mimo ordinačných hodín. Ozveme sa vám do 24 hodín. Prosím, po zaznení tónu povedzte svoje celé meno.'
        );
        twiml.record({
          action: '/voice/record-name',
          playBeep: true,
          maxLength: 10,
          timeout: 3
        });
      }

      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /incoming');
      twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Momentálne máme technické problémy.');
      twiml.reject();
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/gather', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const digits = body.Digits;
    const fromNumber = body.From;
    const callSid = body.CallSid;

    const twiml = new VoiceResponse();

    try {
      if (digits === '1') {
        const config = await prixiService.getConfig(fromNumber);

        if (config.allowForwardDuringOfficeHours && config.forwardPhoneNumber) {
          twiml.dial(config.forwardPhoneNumber);

          const event: CallForwardedEvent = {
            event: 'call_forwarded',
            clinicId: config.clinicId,
            phone: fromNumber,
            forwardedTo: config.forwardPhoneNumber,
            callSid: callSid,
            timestamp: new Date().toISOString()
          };

          const eventKey = createVoiceEventKey(event.event, event.callSid);

          if (claimVoiceEvent(eventKey)) {
            prixiService.sendEvent(event, 3, eventKey)
              .then(() => completeVoiceEvent(eventKey))
              .catch((err: any) => {
                failVoiceEvent(eventKey);
                fastify.log.error(err, 'Failed to report call forwarding');
              });
          }

          // Dispatch event async
        } else {
          // Fallback to record if forwarding isn't allowed
          twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Prosím, po zaznení tónu povedzte svoje celé meno.');
          twiml.record({ action: '/voice/record-name', playBeep: true, maxLength: 10, timeout: 3 });
        }
      } else {
        // Did not press 1 -> Voicemail
        twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Prosím, po zaznení tónu povedzte svoje celé meno.');
        twiml.record({ action: '/voice/record-name', playBeep: true, maxLength: 10, timeout: 3 });
      }
      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /gather');
      twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Prosím, povedzte svoje celé meno.');
      twiml.record({ action: '/voice/record-name', playBeep: true, maxLength: 10, timeout: 3 });
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/record-name', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const nameUrl = body.RecordingUrl;
    
    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Teraz prosím povedzte svoj rok narodenia.');
    twiml.record({
      action: `/voice/record-birthyear?nameUrl=${encodeURIComponent(nameUrl || '')}`,
      playBeep: true,
      maxLength: 5,
      timeout: 3
    });
    
    return reply.type('text/xml').send(twiml.toString());
  });

  fastify.post('/record-birthyear', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const query = request.query as Record<string, string>;
    const birthYearUrl = body.RecordingUrl;
    const nameUrl = query.nameUrl || '';
    
    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Nakoniec prosím popíšte svoj problém.');
    twiml.record({
      action: `/voice/recording-complete?nameUrl=${encodeURIComponent(nameUrl)}&birthYearUrl=${encodeURIComponent(birthYearUrl || '')}`,
      playBeep: true,
      maxLength: 120,
      timeout: 3
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
          nameUrl ? sttService.transcribeAudioUrl(nameUrl) : Promise.resolve(''),
          birthYearUrl ? sttService.transcribeAudioUrl(birthYearUrl) : Promise.resolve(''),
          problemUrl ? sttService.transcribeAudioUrl(problemUrl) : Promise.resolve('')
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
    
    const problemUrl = body.RecordingUrl;
    const nameUrl = query.nameUrl || '';
    const birthYearUrl = query.birthYearUrl || '';
    
    const fromNumber = body.From;
    const providerCallId = body.CallSid;
    const durationSeconds = parseInt(body.RecordingDuration || '0', 10);
    // Rough estimation if exact start/end differ
    const callStartedAt = new Date(Date.now() - durationSeconds * 1000).toISOString();
    const callEndedAt = new Date().toISOString();

    fastify.log.info({ from: fromNumber, durationSeconds, problemUrl }, 'Voicemail recording complete');

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, 'Rozumiem, vaša požiadavka je zaznamenaná. Ozveme sa vám na toto číslo do 24 hodín. Ďakujeme a dovidenia.');
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
