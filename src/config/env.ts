import { z } from 'zod';
import { baseEnvSchema, loadEnv, serviceUrl } from '@novachat-enterprise-erp/common';

const schema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(4006),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  MESSAGE_SERVICE_URL: serviceUrl('http://localhost:4003'),
  LIVEKIT_URL: z.string().regex(/^wss?:\/\//, 'LIVEKIT_URL must start with ws:// or wss://'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export const loadCallEnv = (): Env => loadEnv(schema);
