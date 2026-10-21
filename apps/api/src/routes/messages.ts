import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { parse } from '../plugins/validate.js';
import { serializeMessage } from '../serialize.js';
import { id, writeEvent } from '../services/audit.js';
import { classifyInbound, suggestReply } from '../services/messages.js';

const replySchema = z.object({ body: z.string().min(1).max(4000) });
const inboundSchema = z.object({ orderId: z.string().min(1), body: z.string().min(1).max(4000) });

interface ListQuery {
  orderId?: string;
  unansweredOnly?: string;
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/messages', async (req) => {
    const account = await req.account();
    const unansweredOnly = req.query.unansweredOnly === 'true' || req.query.unansweredOnly === '1';
    const where: Prisma.MessageWhereInput = {
      accountId: account.id,
      ...(req.query.orderId ? { orderId: req.query.orderId } : {}),
      ...(unansweredOnly ? { direction: 'in', answered: false } : {}),
    };
    const rows = await app.db.message.findMany({ where, orderBy: { at: 'desc' }, take: 500 });
    return rows.map(serializeMessage);
  });

  app.post<{ Params: { id: string } }>('/messages/:id/reply', async (req, reply) => {
    const account = await req.account();
    const body = parse(replySchema, req.body ?? {});
    const inbound = await app.db.message.findFirst({ where: { id: req.params.id, accountId: account.id }, include: { order: true } });
    if (!inbound) throw notFound('Message', req.params.id);
    const out = await app.db.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: { id: id('msg'), accountId: account.id, orderId: inbound.orderId, direction: 'out', kind: inbound.kind, body: body.body, answered: true },
      });
      await tx.message.update({ where: { id: inbound.id }, data: { answered: true } });
      await writeEvent(tx, { accountId: account.id, orderId: inbound.orderId, type: 'message.replied', payload: { inReplyTo: inbound.id, kind: inbound.kind } });
      return m;
    });
    await app.connectors.ebay.sendBuyerMessage(inbound.order.ebayOrderId, body.body);
    return reply.code(201).send(serializeMessage(out));
  });

  /**
   * Inbound buyer message (real mode: eBay message webhook; mock mode: the UI's "simulate buyer message").
   * Classified with the keyword classifier; a suggested reply is attached.
   */
  app.post('/messages/inbound', async (req, reply) => {
    const account = await req.account();
    const body = parse(inboundSchema, req.body ?? {});
    const order = await app.db.order.findFirst({ where: { id: body.orderId, accountId: account.id }, include: { listing: { select: { title: true } } } });
    if (!order) throw notFound('Order', body.orderId);
    const kind = classifyInbound(body.body);
    const m = await app.db.message.create({
      data: { id: id('msg'), accountId: account.id, orderId: order.id, direction: 'in', kind, body: body.body, suggestedReply: suggestReply(kind, order, order.listing.title), answered: false },
    });
    await writeEvent(app.db, { accountId: account.id, orderId: order.id, type: 'message.received', payload: { kind } });
    return reply.code(201).send(serializeMessage(m));
  });
}
