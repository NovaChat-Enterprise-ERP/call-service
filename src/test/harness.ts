import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type LiveParticipantDto } from '@novachat-enterprise-erp/contracts';
import { createLogger } from '@novachat-enterprise-erp/common';
import { InMemoryEventBus } from '@novachat-enterprise-erp/events';
import { TEST_SECRET, asUser, createTestDatabase } from '@novachat-enterprise-erp/testing';
import { schema } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { DrizzleMeetingRepository } from '../repositories/meeting.repository.js';
import type { JoinTokenRequest, MediaSource, VideoProvider, VideoWebhookEvent } from '../providers/video-provider.js';
import type { ConversationGateway } from '../providers/conversation-gateway.js';
import { buildContainer } from '../container.js';
import { createApp } from '../app.js';

export const WS = '00000000-0000-4000-8000-0000000000e1';
export const CONV = '00000000-0000-4000-8000-0000000000c1';

export class FakeVideo implements VideoProvider {
  readonly serverUrl = 'wss://video.test';
  rooms = new Set<string>();
  tokens: JoinTokenRequest[] = [];
  muted: [string, string, MediaSource][] = [];
  removed: string[] = [];
  nextWebhook: VideoWebhookEvent | null = null;

  async ensureRoom(room: string) {
    this.rooms.add(room);
  }
  async createJoinToken(request: JoinTokenRequest) {
    this.tokens.push(request);
    return `token-for-${request.identity}`;
  }
  async activeRooms() {
    return new Set(this.rooms);
  }
  async listParticipants(): Promise<LiveParticipantDto[]> {
    return [];
  }
  async mute(room: string, identity: string, source: MediaSource) {
    this.muted.push([room, identity, source]);
    return true;
  }
  async removeParticipant(_room: string, identity: string) {
    this.removed.push(identity);
  }
  async closeRoom(room: string) {
    this.rooms.delete(room);
  }
  async parseWebhook(_body: string, auth: string | undefined) {
    if (auth !== 'valid') throw new Error('bad signature');
    return this.nextWebhook!;
  }
}

class FakeConversations implements ConversationGateway {
  members = new Map([[CONV, ['ada', 'grace']]]);
  posted: string[] = [];
  async isMember(_w: string, conversationId: string, userId: string) {
    return this.members.get(conversationId)?.includes(userId) ?? false;
  }
  async postSystemMessage(_c: string, _a: string, text: string) {
    this.posted.push(text);
  }
}

export const createHarness = async () => {
  const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const { db, close } = await createTestDatabase(schema, migrations, 'calls');
  const video = new FakeVideo();
  const conversations = new FakeConversations();
  const events = new InMemoryEventBus('call-service');
  let seed = 42;
  const container = buildContainer({
    logger: createLogger('test', 'silent'),
    internalSecret: TEST_SECRET,
    meetings: new DrizzleMeetingRepository(db as unknown as Database),
    video,
    conversations,
    events,
    random: (max) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    },
  });
  const as = (userId: string) =>
    asUser({
      userId,
      name: userId.toUpperCase(),
      workspaceId: WS,
      memberId: `m-${userId}`,
      role: userId === 'owner' ? 'owner' : 'member',
      permissions: userId === 'owner' ? ALL_PERMISSIONS : DEFAULT_ROLE_PERMISSIONS.member,
    });
  return { app: createApp(container), container, video, conversations, events, close, as };
};
