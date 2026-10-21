import type { LedgerKind } from '@floor/core';
import { nanoid } from 'nanoid';
import type { Db } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';

/** Either the root client or a transaction client. */
export type Tx = Db | Prisma.TransactionClient;

export const id = (prefix: string): string => `${prefix}_${nanoid(12)}`;

export interface EventInput {
  accountId: string;
  type: string;
  orderId?: string | null;
  listingId?: string | null;
  payload?: Record<string, unknown>;
  at?: Date;
}

export async function writeEvent(tx: Tx, e: EventInput): Promise<void> {
  await tx.event.create({
    data: {
      id: id('evt'),
      accountId: e.accountId,
      orderId: e.orderId ?? null,
      listingId: e.listingId ?? null,
      type: e.type,
      payload: (e.payload ?? {}) as Prisma.InputJsonValue,
      at: e.at ?? new Date(),
    },
  });
}

export interface LedgerInput {
  accountId: string;
  orderId?: string | null;
  kind: LedgerKind;
  /** Signed: revenue positive, costs/fees negative, payout positive (cash in). */
  amountCents: number;
  at?: Date;
}

export async function writeLedger(tx: Tx, e: LedgerInput): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      id: id('led'),
      accountId: e.accountId,
      orderId: e.orderId ?? null,
      kind: e.kind,
      amountCents: Math.trunc(e.amountCents),
      at: e.at ?? new Date(),
    },
  });
}

/** Start of the UTC day containing `now`. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
