import { Router } from 'express';
import { PERMISSIONS } from '@novachat-enterprise-erp/contracts';
import { requireMember, requirePermission } from '@novachat-enterprise-erp/common';
import type { Container } from '../container.js';

export const publicRoutes = ({ controllers: { meetings: m } }: Container): Router => {
  const ws = Router({ mergeParams: true });
  ws.use(requireMember);
  ws.get('/meetings', m.list);
  ws.post('/meetings', requirePermission(PERMISSIONS.MEETINGS_CREATE), m.create);
  ws.get('/meetings/:code', m.get);
  ws.post('/meetings/:code/join', m.join);
  ws.post('/meetings/:code/invites', m.invite);
  ws.get('/meetings/:code/participants', m.participants);
  ws.post('/meetings/:code/participants/:identity/mute', m.mute);
  ws.delete('/meetings/:code/participants/:identity', m.remove);
  ws.post('/meetings/:code/end', m.end);

  const router = Router();
  router.use('/workspaces/:workspaceId', ws);
  return router;
};
