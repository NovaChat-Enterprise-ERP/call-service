import { and, desc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import type { MeetingStatus } from '@novachat-enterprise-erp/contracts';
import type { Database } from '../db/client.js';
import { meetingInvites, meetingParticipants, meetings, type MeetingRow } from '../db/schema.js';

export type NewMeeting = Pick<MeetingRow, 'workspaceId' | 'code' | 'hostId'> &
  Partial<Pick<MeetingRow, 'title' | 'conversationId' | 'scheduledAt'>>;
export type MeetingPatch = Partial<Pick<MeetingRow, 'status' | 'startedAt' | 'endedAt'>>;

export interface MeetingRepository {
  create(input: NewMeeting): Promise<MeetingRow>;
  findById(id: string): Promise<MeetingRow | null>;
  findByCode(code: string): Promise<MeetingRow | null>;
  update(id: string, patch: MeetingPatch): Promise<MeetingRow | null>;
  listForUser(workspaceId: string, userId: string, statuses: MeetingStatus[], limit: number): Promise<MeetingRow[]>;
  listLive(workspaceId: string): Promise<MeetingRow[]>;
  invite(meetingId: string, userIds: string[], invitedBy: string): Promise<string[]>;
  invitedUserIds(meetingIds: string[]): Promise<Map<string, string[]>>;
  isInvited(meetingId: string, userId: string): Promise<boolean>;
  recordJoin(meetingId: string, userId: string): Promise<void>;
  recordLeave(meetingId: string, userId: string): Promise<void>;
  closeOpenParticipants(meetingId: string): Promise<void>;
  activeParticipantIds(meetingIds: string[]): Promise<Map<string, string[]>>;
}

export class DrizzleMeetingRepository implements MeetingRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewMeeting): Promise<MeetingRow> {
    const [row] = await this.db.insert(meetings).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<MeetingRow | null> {
    const [row] = await this.db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
    return row ?? null;
  }

  async findByCode(code: string): Promise<MeetingRow | null> {
    const [row] = await this.db.select().from(meetings).where(eq(meetings.code, code)).limit(1);
    return row ?? null;
  }

  async update(id: string, patch: MeetingPatch): Promise<MeetingRow | null> {
    const [row] = await this.db.update(meetings).set({ ...patch, updatedAt: new Date() }).where(eq(meetings.id, id)).returning();
    return row ?? null;
  }

  async listForUser(workspaceId: string, userId: string, statuses: MeetingStatus[], limit: number): Promise<MeetingRow[]> {
    const invited = exists(
      this.db
        .select({ one: sql`1` })
        .from(meetingInvites)
        .where(and(eq(meetingInvites.meetingId, meetings.id), eq(meetingInvites.userId, userId))),
    );
    const participated = exists(
      this.db
        .select({ one: sql`1` })
        .from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, meetings.id), eq(meetingParticipants.userId, userId))),
    );
    return this.db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.workspaceId, workspaceId),
          inArray(meetings.status, statuses),
          or(eq(meetings.hostId, userId), invited, participated),
        ),
      )
      .orderBy(desc(meetings.createdAt))
      .limit(limit);
  }

  async listLive(workspaceId: string): Promise<MeetingRow[]> {
    return this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.workspaceId, workspaceId), eq(meetings.status, 'live')));
  }

  async invite(meetingId: string, userIds: string[], invitedBy: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .insert(meetingInvites)
      .values([...new Set(userIds)].map((userId) => ({ meetingId, userId, invitedBy })))
      .onConflictDoNothing()
      .returning({ userId: meetingInvites.userId });
    return rows.map((r) => r.userId);
  }

  async invitedUserIds(meetingIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (meetingIds.length === 0) return map;
    const rows = await this.db.select().from(meetingInvites).where(inArray(meetingInvites.meetingId, meetingIds));
    for (const r of rows) map.set(r.meetingId, [...(map.get(r.meetingId) ?? []), r.userId]);
    return map;
  }

  async isInvited(meetingId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: meetingInvites.userId })
      .from(meetingInvites)
      .where(and(eq(meetingInvites.meetingId, meetingId), eq(meetingInvites.userId, userId)))
      .limit(1);
    return !!row;
  }

  async recordJoin(meetingId: string, userId: string): Promise<void> {
    const [open] = await this.db
      .select({ id: meetingParticipants.id })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, userId), isNull(meetingParticipants.leftAt)))
      .limit(1);
    if (!open) await this.db.insert(meetingParticipants).values({ meetingId, userId });
  }

  async recordLeave(meetingId: string, userId: string): Promise<void> {
    await this.db
      .update(meetingParticipants)
      .set({ leftAt: new Date() })
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, userId), isNull(meetingParticipants.leftAt)));
  }

  async closeOpenParticipants(meetingId: string): Promise<void> {
    await this.db
      .update(meetingParticipants)
      .set({ leftAt: new Date() })
      .where(and(eq(meetingParticipants.meetingId, meetingId), isNull(meetingParticipants.leftAt)));
  }

  async activeParticipantIds(meetingIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (meetingIds.length === 0) return map;
    const rows = await this.db
      .selectDistinct({ meetingId: meetingParticipants.meetingId, userId: meetingParticipants.userId })
      .from(meetingParticipants)
      .where(and(inArray(meetingParticipants.meetingId, meetingIds), isNull(meetingParticipants.leftAt)));
    for (const r of rows) map.set(r.meetingId, [...(map.get(r.meetingId) ?? []), r.userId]);
    return map;
  }
}
