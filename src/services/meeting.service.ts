import { randomInt } from 'node:crypto';
import {
  EVENTS,
  PERMISSIONS,
  generateMeetingCode,
  type CreateMeetingInput,
  type LiveParticipantDto,
  type MeetingDto,
  type MeetingJoinDto,
  type MeetingStatus,
} from '@novachat-enterprise-erp/contracts';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  isUniqueViolation,
  type Logger,
  type MemberContext,
} from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { MeetingRow } from '../db/schema.js';
import type { MeetingRepository } from '../repositories/meeting.repository.js';
import type { MediaSource, VideoProvider } from '../providers/video-provider.js';
import type { ConversationGateway } from '../providers/conversation-gateway.js';

export const roomName = (meetingId: string) => `nc-${meetingId}`;
const meetingIdFromRoom = (room: string | null) => (room?.startsWith('nc-') ? room.slice(3) : null);

const RECONCILE_GRACE_MS = 120_000;

export class MeetingService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly video: VideoProvider,
    private readonly conversations: ConversationGateway,
    private readonly events: EventPublisher,
    private readonly logger: Logger,
    private readonly random: (max: number) => number = (max) => randomInt(max),
  ) {}

  async create(actor: MemberContext, input: CreateMeetingInput): Promise<MeetingDto> {
    if (input.conversationId && !(await this.conversations.isMember(actor.workspaceId, input.conversationId, actor.userId))) {
      throw new ForbiddenError('You are not a member of that conversation');
    }
    const meeting = await this.createWithUniqueCode(actor, input);
    if (input.inviteUserIds.length) await this.invite(actor, meeting.code, input.inviteUserIds);

    if (meeting.conversationId) {
      await this.conversations
        .postSystemMessage(meeting.conversationId, actor.userId, `${actor.name ?? 'Someone'} started a meeting`, {
          type: 'meeting',
          meetingId: meeting.id,
          code: meeting.code,
          title: meeting.title,
        })
        .catch((err) => this.logger.warn({ err }, 'Could not post meeting message'));
    }
    return this.dto(meeting);
  }

  async list(actor: MemberContext, status: 'live' | 'scheduled' | 'ended' | 'active', limit: number): Promise<MeetingDto[]> {
    await this.reconcile(actor.workspaceId);
    const statuses: MeetingStatus[] = status === 'active' ? ['live', 'scheduled'] : [status];
    const rows = await this.meetings.listForUser(actor.workspaceId, actor.userId, statuses, limit);
    return this.dtos(rows);
  }

  async get(actor: MemberContext, code: string): Promise<MeetingDto> {
    return this.dto(await this.load(actor, code));
  }

  async join(actor: MemberContext, code: string): Promise<MeetingJoinDto> {
    let meeting = await this.load(actor, code);
    if (meeting.status === 'ended') throw new AppError(410, 'MEETING_ENDED', 'This meeting has ended');
    await this.assertCanJoin(actor, meeting);

    const room = roomName(meeting.id);
    await this.video.ensureRoom(room);
    const isHost = this.isHost(actor, meeting);
    const token = await this.video.createJoinToken({
      room,
      identity: actor.userId,
      name: actor.name ?? actor.email ?? 'Guest',
      admin: isHost,
      metadata: { userId: actor.userId, meetingId: meeting.id },
    });

    if (meeting.status !== 'live') {
      meeting = (await this.meetings.update(meeting.id, { status: 'live', startedAt: new Date() }))!;
      await this.publish(EVENTS.MEETING_STARTED, meeting, actor.userId);
    }
    await this.meetings.recordJoin(meeting.id, actor.userId);
    return { meeting: await this.dto(meeting), serverUrl: this.video.serverUrl, token, identity: actor.userId, isHost };
  }

  async invite(actor: MemberContext, code: string, userIds: string[]): Promise<MeetingDto> {
    const meeting = await this.load(actor, code);
    if (meeting.status === 'ended') throw new AppError(410, 'MEETING_ENDED', 'This meeting has ended');
    await this.assertCanJoin(actor, meeting);
    const added = await this.meetings.invite(meeting.id, userIds.filter((u) => u !== actor.userId), actor.userId);
    const dto = await this.dto(meeting);
    if (added.length) {
      await this.events.publish({
        type: EVENTS.MEETING_INVITED,
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        data: { meeting: dto, userIds: added, inviterName: actor.name ?? null },
      });
    }
    return dto;
  }

  async participants(actor: MemberContext, code: string): Promise<LiveParticipantDto[]> {
    const meeting = await this.load(actor, code);
    if (meeting.status !== 'live') return [];
    return this.video.listParticipants(roomName(meeting.id));
  }

  async mute(actor: MemberContext, code: string, identity: string, source: MediaSource): Promise<boolean> {
    const meeting = await this.loadAsHost(actor, code);
    return this.video.mute(roomName(meeting.id), identity, source);
  }

  async removeParticipant(actor: MemberContext, code: string, identity: string): Promise<void> {
    const meeting = await this.loadAsHost(actor, code);
    if (identity === meeting.hostId) throw new ForbiddenError('The host cannot be removed');
    await this.video.removeParticipant(roomName(meeting.id), identity);
    await this.meetings.recordLeave(meeting.id, identity);
  }

  async end(actor: MemberContext, code: string): Promise<MeetingDto> {
    const meeting = await this.loadAsHost(actor, code);
    if (meeting.status === 'ended') return this.dto(meeting);
    await this.video.closeRoom(roomName(meeting.id));
    return this.dto(await this.markEnded(meeting, actor.userId));
  }

  async handleWebhook(body: string, authorization: string | undefined): Promise<void> {
    const event = await this.video.parseWebhook(body, authorization);
    const meetingId = meetingIdFromRoom(event.room);
    if (!meetingId) return;
    const meeting = await this.meetings.findById(meetingId);
    if (!meeting) return;

    switch (event.type) {
      case 'participant_joined':
        if (!event.identity) return;
        await this.meetings.recordJoin(meeting.id, event.identity);
        await this.publish(EVENTS.MEETING_PARTICIPANT_JOINED, meeting, event.identity, { userId: event.identity });
        return;
      case 'participant_left':
        if (!event.identity) return;
        await this.meetings.recordLeave(meeting.id, event.identity);
        await this.publish(EVENTS.MEETING_PARTICIPANT_LEFT, meeting, event.identity, { userId: event.identity });
        return;
      case 'room_finished':
        if (meeting.status !== 'ended') await this.markEnded(meeting, meeting.hostId);
        return;
    }
  }

  async reconcile(workspaceId: string, now = Date.now()): Promise<void> {
    const live = await this.meetings.listLive(workspaceId);
    const stale = live.filter((m) => m.startedAt && now - m.startedAt.getTime() > RECONCILE_GRACE_MS);
    if (stale.length === 0) return;
    let active: Set<string>;
    try {
      active = await this.video.activeRooms();
    } catch (err) {
      this.logger.warn({ err }, 'Could not reconcile meetings with the video provider');
      return;
    }
    for (const meeting of stale) {
      if (!active.has(roomName(meeting.id))) await this.markEnded(meeting, meeting.hostId);
    }
  }

  private async markEnded(meeting: MeetingRow, actorId: string): Promise<MeetingRow> {
    const ended = (await this.meetings.update(meeting.id, { status: 'ended', endedAt: new Date() }))!;
    await this.meetings.closeOpenParticipants(meeting.id);
    await this.publish(EVENTS.MEETING_ENDED, ended, actorId);
    return ended;
  }

  private async createWithUniqueCode(actor: MemberContext, input: CreateMeetingInput): Promise<MeetingRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.meetings.create({
          workspaceId: actor.workspaceId,
          code: generateMeetingCode(this.random),
          hostId: actor.userId,
          title: input.title ?? null,
          conversationId: input.conversationId ?? null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new AppError(503, 'CODE_EXHAUSTED', 'Could not allocate a meeting code, please retry');
  }

  private async assertCanJoin(actor: MemberContext, meeting: MeetingRow): Promise<void> {
    if (!meeting.conversationId || this.isHost(actor, meeting)) return;
    if (await this.meetings.isInvited(meeting.id, actor.userId)) return;
    if (await this.conversations.isMember(actor.workspaceId, meeting.conversationId, actor.userId)) return;
    throw new ForbiddenError('This meeting is limited to members of its conversation');
  }

  private isHost(actor: MemberContext, meeting: MeetingRow): boolean {
    return meeting.hostId === actor.userId || actor.permissions.includes(PERMISSIONS.MEETINGS_MANAGE_ANY);
  }

  private async load(actor: MemberContext, code: string): Promise<MeetingRow> {
    const meeting = await this.meetings.findByCode(code);
    if (!meeting || meeting.workspaceId !== actor.workspaceId) throw new NotFoundError('Meeting');
    return meeting;
  }

  private async loadAsHost(actor: MemberContext, code: string): Promise<MeetingRow> {
    const meeting = await this.load(actor, code);
    if (!this.isHost(actor, meeting)) throw new ForbiddenError('Only the host can do this');
    return meeting;
  }

  private async publish(type: (typeof EVENTS)[keyof typeof EVENTS], meeting: MeetingRow, actorId: string, extra: Record<string, unknown> = {}) {
    await this.events.publish({
      type,
      workspaceId: meeting.workspaceId,
      actorId,
      data: { meeting: await this.dto(meeting), ...extra },
    });
  }

  private async dto(meeting: MeetingRow): Promise<MeetingDto> {
    return (await this.dtos([meeting]))[0]!;
  }

  private async dtos(rows: MeetingRow[]): Promise<MeetingDto[]> {
    const ids = rows.map((r) => r.id);
    const [active, invited] = await Promise.all([this.meetings.activeParticipantIds(ids), this.meetings.invitedUserIds(ids)]);
    return rows.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      code: m.code,
      title: m.title,
      hostId: m.hostId,
      conversationId: m.conversationId,
      status: m.status,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      activeParticipantIds: m.status === 'live' ? (active.get(m.id) ?? []) : [],
      invitedUserIds: invited.get(m.id) ?? [],
      joinPath: `buzz/${m.code}`,
    }));
  }
}
