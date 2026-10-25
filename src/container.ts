import type { Logger, ReadinessCheck } from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { MeetingRepository } from './repositories/meeting.repository.js';
import type { VideoProvider } from './providers/video-provider.js';
import type { ConversationGateway } from './providers/conversation-gateway.js';
import { MeetingService } from './services/meeting.service.js';
import { MeetingController } from './controllers/meeting.controller.js';

export interface ContainerDeps {
  logger: Logger;
  internalSecret: string;
  meetings: MeetingRepository;
  video: VideoProvider;
  conversations: ConversationGateway;
  events: EventPublisher;
  random?: (max: number) => number;
  readiness?: Record<string, ReadinessCheck>;
}

export const buildContainer = (deps: ContainerDeps) => {
  const services = {
    meetings: new MeetingService(deps.meetings, deps.video, deps.conversations, deps.events, deps.logger, deps.random),
  };
  return {
    logger: deps.logger,
    internalSecret: deps.internalSecret,
    readiness: deps.readiness ?? {},
    services,
    controllers: { meetings: new MeetingController(services.meetings) },
  };
};

export type Container = ReturnType<typeof buildContainer>;
