import 'dotenv/config';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import twilio from 'twilio';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { voiceRoutes } from './routes/voice.controller';

const KLOSTERMANN_GREETING_PATH = resolve(__dirname, 'assets/audio/klostermann-greeting-v5.wav');

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
