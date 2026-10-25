import { index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { MeetingStatus } from '@novachat-enterprise-erp/contracts';

export const callsSchema = pgSchema('calls');

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 6 });

export const meetings = callsSchema.table(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    code: text('code').notNull().unique(),
    title: text('title'),
    hostId: text('host_id').notNull(),
    conversationId: uuid('conversation_id'),
    status: text('status').$type<MeetingStatus>().notNull().default('scheduled'),
    scheduledAt: ts('scheduled_at'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('meetings_workspace_status_idx').on(t.workspaceId, t.status, t.createdAt.desc())],
);

export const meetingParticipants = callsSchema.table(
  'meeting_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
  },
  (t) => [index('meeting_participants_meeting_idx').on(t.meetingId, t.userId)],
);

export const meetingInvites = callsSchema.table(
  'meeting_invites',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    invitedBy: text('invited_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] }), index('meeting_invites_user_idx').on(t.userId)],
);

export const schema = { meetings, meetingParticipants, meetingInvites };

export type MeetingRow = typeof meetings.$inferSelect;
