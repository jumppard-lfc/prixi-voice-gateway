import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import twilio from 'twilio';
import { voiceRoutes } from './routes/voice.controller';

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty'
    } : undefined
  }
});

app.register(formbody);

app.get('/health', async () => ({ status: 'UP' }));

// Fastify preHandler to globally secure /voice routes with X-Twilio-Signature
app.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/voice')) {
    if (process.env.NODE_ENV === 'production') {
      const twilioSignature = request.headers['x-twilio-signature'] as string;
      const validationToken = process.env.TWILIO_AUTH_TOKEN || '';
      
      // Twilio requires full absolute URL for signature validation
      const host = request.headers['host'];
      const protocol = request.headers['x-forwarded-proto'] || 'https';
      const url = `${protocol}://${host}${request.url}`;
      
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
