import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import type { LiveParticipantDto } from '@novachat-enterprise-erp/contracts';

export type MediaSource = 'microphone' | 'camera' | 'screen_share';

export interface JoinTokenRequest {
  room: string;
  identity: string;
  name: string;
  admin: boolean;
  metadata?: Record<string, unknown>;
}

export interface VideoWebhookEvent {
  type: 'room_started' | 'room_finished' | 'participant_joined' | 'participant_left' | 'other';
  room: string | null;
  identity: string | null;
}

export interface VideoProvider {
  readonly serverUrl: string;
  ensureRoom(room: string): Promise<void>;
  createJoinToken(request: JoinTokenRequest): Promise<string>;
  activeRooms(): Promise<Set<string>>;
  listParticipants(room: string): Promise<LiveParticipantDto[]>;
  mute(room: string, identity: string, source: MediaSource): Promise<boolean>;
  removeParticipant(room: string, identity: string): Promise<void>;
  closeRoom(room: string): Promise<void>;
  parseWebhook(body: string, authorization: string | undefined): Promise<VideoWebhookEvent>;
}

const SOURCES: Record<MediaSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
};

const isNotFound = (error: unknown) =>
  (error as { status?: number; code?: string }).status === 404 || (error as { code?: string }).code === 'not_found';

export class LiveKitVideoProvider implements VideoProvider {
  private readonly rooms: RoomServiceClient;
  private readonly webhooks: WebhookReceiver;

  constructor(
    readonly serverUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {
    this.rooms = new RoomServiceClient(serverUrl.replace(/^ws/, 'http'), apiKey, apiSecret);
    this.webhooks = new WebhookReceiver(apiKey, apiSecret);
  }

  async ensureRoom(room: string): Promise<void> {
    await this.rooms.createRoom({ name: room, emptyTimeout: 300, departureTimeout: 60, maxParticipants: 100 });
  }

  async createJoinToken({ room, identity, name, admin, metadata }: JoinTokenRequest): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name,
      ttl: '2h',
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });
    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: admin,
    });
    return token.toJwt();
  }

  async activeRooms(): Promise<Set<string>> {
    return new Set((await this.rooms.listRooms()).map((r) => r.name));
  }

  async listParticipants(room: string): Promise<LiveParticipantDto[]> {
    try {
      const participants = await this.rooms.listParticipants(room);
      return participants.map((p) => {
        const track = (source: TrackSource) => p.tracks.find((t) => t.source === source);
        return {
          identity: p.identity,
          name: p.name,
          joinedAt: p.joinedAt ? new Date(Number(p.joinedAt) * 1000).toISOString() : null,
          microphoneMuted: track(TrackSource.MICROPHONE)?.muted ?? null,
          cameraMuted: track(TrackSource.CAMERA)?.muted ?? null,
          isScreenSharing: !!track(TrackSource.SCREEN_SHARE),
        };
      });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async mute(room: string, identity: string, source: MediaSource): Promise<boolean> {
    const participant = await this.rooms.getParticipant(room, identity);
    const track = participant.tracks.find((t) => t.source === SOURCES[source]);
    if (!track) return false;
    await this.rooms.mutePublishedTrack(room, identity, track.sid, true);
    return true;
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.rooms.removeParticipant(room, identity);
  }

  async closeRoom(room: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(room);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async parseWebhook(body: string, authorization: string | undefined): Promise<VideoWebhookEvent> {
    const event = await this.webhooks.receive(body, authorization);
    const known = ['room_started', 'room_finished', 'participant_joined', 'participant_left'] as const;
    const type = (known as readonly string[]).includes(event.event) ? (event.event as VideoWebhookEvent['type']) : 'other';
    return { type, room: event.room?.name ?? null, identity: event.participant?.identity ?? null };
  }
}
