import 'dotenv/config';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import twilio from 'twilio';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { voiceRoutes } from './routes/voice.controller';
import { voiceBotBuilderRoutes } from './routes/voice-bot-builder.controller';
import { demoVoiceBotRoutes } from './routes/demo-voice-bot.controller';

const KLOSTERMANN_GREETING_PATH = resolve(__dirname, 'assets/audio/klostermann-greeting-v5.wav');

function createPromptToneWav(): Buffer {
  const sampleRate = 8_000;
  const durationSeconds = 0.12;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataLength = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 80, (sampleCount - index) / 80);
    const sample = Math.round(Math.sin((2 * Math.PI * 880 * index) / sampleRate) * 9_000 * envelope);
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

const BOOKING_PROMPT_TONE_WAV = createPromptToneWav();

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value.split(',')[0]?.trim();
}

function buildTwilioValidationUrl(request: { headers: Record<string, string | string[] | undefined>; raw: { url?: string }; url: string }): string | null {
  const forwardedProto = normalizeHeaderValue(request.headers['x-forwarded-proto']) || 'https';
  const forwardedHost = normalizeHeaderValue(request.headers['x-forwarded-host']) || normalizeHeaderValue(request.headers.host);
  const requestPath = request.raw.url || request.url;

  if (!forwardedHost) {
    return null;
  }

  return `${forwardedProto}://${forwardedHost}${requestPath}`;
}

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty'
    } : undefined
  }
});

app.register(formbody);

app.get('/health', async () => ({ status: 'UP' }));

app.get('/media/klostermann-greeting-v5.wav', async (_request, reply) => {
  const audioStats = statSync(KLOSTERMANN_GREETING_PATH);

  return reply
    .type('audio/wav')
    .header('Content-Length', audioStats.size)
    .header('Cache-Control', 'public, max-age=31536000, immutable')
    .send(createReadStream(KLOSTERMANN_GREETING_PATH));
});

app.get('/media/booking-prompt-tone.wav', async (_request, reply) => reply
  .type('audio/wav')
  .header('Content-Length', BOOKING_PROMPT_TONE_WAV.length)
  .header('Cache-Control', 'public, max-age=31536000, immutable')
  .send(BOOKING_PROMPT_TONE_WAV));

// Fastify preHandler to globally secure /voice routes with X-Twilio-Signature
app.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/voice')) {
    const twilioSignature = normalizeHeaderValue(request.headers['x-twilio-signature']);
    const validationToken = process.env.TWILIO_AUTH_TOKEN || '';
    const url = buildTwilioValidationUrl(request);

    if (!twilioSignature || !validationToken || !url) {
      app.log.warn({ url, hasSignature: Boolean(twilioSignature), hasToken: Boolean(validationToken) }, 'Rejecting request: Missing Twilio signature context.');
      return reply.code(403).send('Forbidden');
    }

    const payload = request.body as Record<string, string>;

    const isValid = twilio.validateRequest(
      validationToken,
      twilioSignature,
      url,
      payload
    );

    if (!isValid) {
      app.log.warn({ url, signature: twilioSignature }, 'Rejecting request: Invalid Twilio Signature.');
      return reply.code(403).send('Forbidden');
    }
  }
});

app.register(voiceRoutes, { prefix: '/voice' });
app.register(demoVoiceBotRoutes, { prefix: '/voice' });
app.register(voiceBotBuilderRoutes);

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`Voice Gateway started on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

export default app;
