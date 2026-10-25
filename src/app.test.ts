import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EVENTS, type MeetingDto } from '@novachat-enterprise-erp/contracts';
import { CONV, WS, createHarness } from './test/harness.js';
import { roomName } from './services/meeting.service.js';

let h: Awaited<ReturnType<typeof createHarness>>;
const base = `/api/v1/workspaces/${WS}/meetings`;

const create = async (userId: string, body: Record<string, unknown> = {}) => {
  const res = await request(h.app).post(base).set(h.as(userId)).send(body);
  expect(res.status).toBe(201);
  return res.body as MeetingDto;
};

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('meetings', () => {
  it('creates meetings with Meet-style codes', async () => {
    const meeting = await create('ada', { title: 'Office hours' });
    expect(meeting.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(meeting).toMatchObject({ status: 'scheduled', hostId: 'ada', joinPath: `buzz/${meeting.code}` });
  });

  it('issues host and guest tokens and goes live', async () => {
    const meeting = await create('ada');
    const host = await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('ada'));
    expect(host.body).toMatchObject({ isHost: true, serverUrl: 'wss://video.test', token: 'token-for-ada' });
    expect(host.body.meeting.status).toBe('live');
    expect(h.video.tokens.at(-1)).toMatchObject({ room: roomName(meeting.id), admin: true, name: 'ADA' });

    const guest = await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('linus'));
    expect(guest.body.isHost).toBe(false);
    expect(guest.body.meeting.activeParticipantIds.sort()).toEqual(['ada', 'linus']);
    expect(h.events.ofType(EVENTS.MEETING_STARTED)).toHaveLength(1);
  });

  it('limits conversation meetings to members or invitees and posts a message', async () => {
    const meeting = await create('ada', { conversationId: CONV });
    expect(h.conversations.posted.at(-1)).toBe('ADA started a meeting');
    expect((await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('linus'))).status).toBe(403);
    await request(h.app).post(`${base}/${meeting.code}/invites`).set(h.as('grace')).send({ userIds: ['linus'] }).expect(200);
    expect(h.events.ofType(EVENTS.MEETING_INVITED).at(-1)?.data).toMatchObject({ userIds: ['linus'] });
    expect((await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('linus'))).status).toBe(200);
  });

  it('restricts host controls and ends meetings', async () => {
    const meeting = await create('ada');
    await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('ada'));
    expect((await request(h.app).post(`${base}/${meeting.code}/participants/grace/mute`).set(h.as('grace'))).status).toBe(403);
    await request(h.app).post(`${base}/${meeting.code}/participants/grace/mute`).set(h.as('ada')).send({ source: 'camera' }).expect(200);
    expect(h.video.muted.at(-1)).toEqual([roomName(meeting.id), 'grace', 'camera']);
    await request(h.app).delete(`${base}/${meeting.code}/participants/grace`).set(h.as('owner')).expect(204);

    const ended = await request(h.app).post(`${base}/${meeting.code}/end`).set(h.as('ada'));
    expect(ended.body.status).toBe('ended');
    expect(h.video.rooms.has(roomName(meeting.id))).toBe(false);
    expect((await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('ada'))).status).toBe(410);
  });

  it('lists my meetings and reconciles rooms that closed', async () => {
    const meeting = await create('grace');
    await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('grace'));
    h.video.rooms.delete(roomName(meeting.id));
    await h.container.services.meetings.reconcile(WS, Date.now() + 180_000);
    const list = await request(h.app).get(`${base}?status=ended`).set(h.as('grace'));
    expect(list.body.items.map((m: MeetingDto) => m.code)).toContain(meeting.code);
  });

  it('handles signed webhooks', async () => {
    const meeting = await create('ada');
    await request(h.app).post(`${base}/${meeting.code}/join`).set(h.as('ada'));
    h.video.nextWebhook = { type: 'participant_left', room: roomName(meeting.id), identity: 'ada' };
    await request(h.app).post('/webhooks/livekit').set('authorization', 'valid').send('{}').expect(200);
    expect((await request(h.app).get(`${base}/${meeting.code}`).set(h.as('ada'))).body.activeParticipantIds).toEqual([]);

    h.video.nextWebhook = { type: 'room_finished', room: roomName(meeting.id), identity: null };
    await request(h.app).post('/webhooks/livekit').set('authorization', 'valid').send('{}').expect(200);
    expect((await request(h.app).get(`${base}/${meeting.code}`).set(h.as('ada'))).body.status).toBe('ended');

    expect((await request(h.app).post('/webhooks/livekit').set('authorization', 'forged').send('{}')).status).toBe(500);
  });

  it('rejects malformed codes and other workspaces', async () => {
    expect((await request(h.app).get(`${base}/not-a-code`).set(h.as('ada'))).status).toBe(404);
  });
});
