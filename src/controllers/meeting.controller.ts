import type { Request, Response } from 'express';
import {
  createMeetingSchema,
  inviteToMeetingSchema,
  listMeetingsQuerySchema,
  meetingCodeSchema,
  muteParticipantSchema,
} from '@novachat-enterprise-erp/contracts';
import { NotFoundError, memberContext, parse, stringParam } from '@novachat-enterprise-erp/common';
import type { MeetingService } from '../services/meeting.service.js';

const code = (req: Request) => {
  const result = meetingCodeSchema.safeParse(req.params.code);
  if (!result.success) throw new NotFoundError('Meeting');
  return result.data;
};

export class MeetingController {
  constructor(private readonly meetings: MeetingService) {}

  list = async (req: Request, res: Response) => {
    const { status, limit } = parse(listMeetingsQuerySchema, req.query);
    res.json({ items: await this.meetings.list(memberContext(req), status, limit) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.meetings.create(memberContext(req), parse(createMeetingSchema, req.body ?? {})));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.meetings.get(memberContext(req), code(req)));
  };

  join = async (req: Request, res: Response) => {
    res.json(await this.meetings.join(memberContext(req), code(req)));
  };

  invite = async (req: Request, res: Response) => {
    const { userIds } = parse(inviteToMeetingSchema, req.body);
    res.json(await this.meetings.invite(memberContext(req), code(req), userIds));
  };

  participants = async (req: Request, res: Response) => {
    res.json({ items: await this.meetings.participants(memberContext(req), code(req)) });
  };

  mute = async (req: Request, res: Response) => {
    const { source } = parse(muteParticipantSchema, req.body ?? {});
    res.json({ muted: await this.meetings.mute(memberContext(req), code(req), stringParam(req, 'identity'), source) });
  };

  remove = async (req: Request, res: Response) => {
    await this.meetings.removeParticipant(memberContext(req), code(req), stringParam(req, 'identity'));
    res.status(204).end();
  };

  end = async (req: Request, res: Response) => {
    res.json(await this.meetings.end(memberContext(req), code(req)));
  };

  webhook = async (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
    await this.meetings.handleWebhook(body, req.headers.authorization);
    res.status(200).json({ ok: true });
  };
}
