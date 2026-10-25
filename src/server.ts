import { InternalHttpClient, createLogger, startServer } from '@novachat-enterprise-erp/common';
import { RedisStreamEventPublisher } from '@novachat-enterprise-erp/events';
import { loadCallEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { DrizzleMeetingRepository } from './repositories/meeting.repository.js';
import { LiveKitVideoProvider } from './providers/video-provider.js';
import { MessageServiceConversationGateway } from './providers/conversation-gateway.js';
import { buildContainer } from './container.js';
import { createApp } from './app.js';

const env = loadCallEnv();
const logger = createLogger('call-service', env.LOG_LEVEL);
const { db, pool } = createDatabase(env.DATABASE_URL, (err) =>
  logger.warn({ err }, 'Idle database connection failed; the pool will reconnect'),
);
const events = new RedisStreamEventPublisher({ redisUrl: env.REDIS_URL, source: 'call-service' });

const container = buildContainer({
  logger,
  internalSecret: env.INTERNAL_SECRET,
  meetings: new DrizzleMeetingRepository(db),
  video: new LiveKitVideoProvider(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET),
  conversations: new MessageServiceConversationGateway(
    new InternalHttpClient(env.MESSAGE_SERVICE_URL, env.INTERNAL_SECRET, 'call-service'),
  ),
  events,
  readiness: { database: async () => void (await pool.query('select 1')) },
});

startServer({
  app: createApp(container),
  port: env.PORT,
  logger,
  onShutdown: [() => events.close(), () => pool.end()],
});
