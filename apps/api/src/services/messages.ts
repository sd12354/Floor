import type { MessageKind } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Message, Order } from '../generated/prisma/client.js';
import { id, type Tx } from './audit.js';

type OutboundKind = Extract<MessageKind, 'order_confirmed' | 'shipped' | 'delivered'>;

const firstName = (buyer: string): string => buyer.trim().split(/\s+/)[0] || 'there';

export function renderTemplate(kind: OutboundKind, order: Order, listingTitle: string): string {
  const name = firstName(order.buyerName);
  switch (kind) {
    case 'order_confirmed':
      return `Hi ${name}, thanks for your order of "${listingTitle}"! It's confirmed and being prepared for shipment. We'll send tracking as soon as it's on its way.`;
    case 'shipped':
      return `Hi ${name}, good news: your "${listingTitle}" has shipped via ${order.carrier ?? 'the carrier'}. Tracking number: ${order.trackingNumber ?? 'pending'}. Thanks for shopping with us!`;
    case 'delivered':
      return `Hi ${name}, tracking shows your "${listingTitle}" was delivered. We hope you love it. If anything isn't right, just reply here and we'll sort it out.`;
  }
}

/** Write an outbound templated message and push it through the eBay connector (mock: recorded). */
export async function sendOutbound(tx: Tx, connectors: Connectors, order: Order, listingTitle: string, kind: OutboundKind): Promise<Message> {
  const body = renderTemplate(kind, order, listingTitle);
  const message = await tx.message.create({
    data: { id: id('msg'), accountId: order.accountId, orderId: order.id, direction: 'out', kind, body, answered: true },
  });
  await connectors.ebay.sendBuyerMessage(order.ebayOrderId, body);
  return message;
}

export type InboundKind = Extract<MessageKind, 'wismo' | 'cancel' | 'return' | 'other'>;

const RULES: { kind: InboundKind; re: RegExp }[] = [
  { kind: 'cancel', re: /\b(cancel|cancellation|don'?t (want|need) (it|this)|changed my mind|stop (the|my) order)\b/i },
  { kind: 'return', re: /\b(return|refund|money back|broken|damaged|defective|wrong (item|size|color)|doesn'?t work|not working|rma)\b/i },
  { kind: 'wismo', re: /\b(where is|where'?s|wheres|track(ing)?|status|shipped|arrive|arrival|delivery|delivered|when will|eta|hasn'?t (arrived|come|shipped)|not (received|arrived))\b/i },
];

/** Tiny keyword classifier for inbound buyer messages. */
export function classifyInbound(body: string): InboundKind {
  for (const rule of RULES) if (rule.re.test(body)) return rule.kind;
  return 'other';
}

export function suggestReply(kind: InboundKind, order: Order, listingTitle: string): string {
  const name = firstName(order.buyerName);
  switch (kind) {
    case 'wismo':
      if (order.trackingNumber) {
        return `Hi ${name}, your "${listingTitle}" shipped via ${order.carrier ?? 'the carrier'} with tracking ${order.trackingNumber}. It should arrive within a few business days. Thanks for your patience!`;
      }
      return `Hi ${name}, your "${listingTitle}" is being prepared for shipment and tracking will be posted to your order within our handling window. Thanks for your patience!`;
    case 'cancel':
      return ['paid', 'checking', 'held', 'queued'].includes(order.status)
        ? `Hi ${name}, no problem: we've cancelled your order for "${listingTitle}" and a full refund is on its way.`
        : `Hi ${name}, your "${listingTitle}" has already shipped so we can't cancel it, but you're welcome to return it once it arrives for a full refund.`;
    case 'return':
      return `Hi ${name}, sorry to hear that. We accept returns within 30 days: please open a return request from your order page and we'll send a prepaid label right away.`;
    case 'other':
      return `Hi ${name}, thanks for reaching out about "${listingTitle}". We're looking into this and will get back to you shortly.`;
  }
}
