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
        twiml.record({
          action: '/voice/recording-complete',
          playBeep: true,
          maxLength: 120
        });
      } else {
        twiml.say(
          { language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any },
          'Momentálne sa nachádzate mimo ordinačných hodín. Prosím, po zaznení tónu povedzte svoje meno a zanechajte hlasovú správu.'
        );
        twiml.record({
          action: '/voice/recording-complete',
          playBeep: true,
          maxLength: 120
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
          twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
        }
      } else {
        // Did not press 1 -> Voicemail
        twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
      }
      return reply.type('text/xml').send(twiml.toString());
    } catch (err) {
      fastify.log.error(err, 'Error in /gather');
      twiml.record({ action: '/voice/recording-complete', playBeep: true, maxLength: 120 });
      return reply.type('text/xml').send(twiml.toString());
    }
  });

  fastify.post('/recording-complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string>;
    const recordingUrl = body.RecordingUrl;
    const fromNumber = body.From;
    const providerCallId = body.CallSid;
    const durationSeconds = parseInt(body.RecordingDuration || '0', 10);
    // Rough estimation if exact start/end differ
    const callStartedAt = new Date(Date.now() - durationSeconds * 1000).toISOString();
    const callEndedAt = new Date().toISOString();

    const twiml = new VoiceResponse();
    twiml.say({ language: 'sk-SK', voice: 'Google.sk-SK-Wavenet-A' as any }, '\u010eakujeme, va\u0161a spr\u00e1va bola zaznamenan\u00e1. Dovidenia.');
    twiml.hangup();
    reply.type('text/xml').send(twiml.toString());

    if (!recordingUrl) return;

    const eventKey = createVoiceEventKey('voicemail_recorded', providerCallId);

    if (!claimVoiceEvent(eventKey)) {
      fastify.log.info({ providerCallId }, 'Duplicate voicemail webhook ignored');
      return;
    }

    try {
      const config = await prixiService.getConfig(fromNumber);

      try {
        const transcript = await sttService.transcribeAudioUrl(recordingUrl);
        const event: VoicemailRecordedEvent = {
          event: 'voicemail_recorded',
          clinicId: config.clinicId,
          phone: fromNumber,
          durationSeconds,
          callStartedAt,
          callEndedAt,
          providerCallId,
          audioUrl: recordingUrl,
          transcript
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
          audioUrl: recordingUrl,
          transcript: ''
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
  });
}
