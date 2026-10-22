import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import type { Account } from '../generated/prisma/client.js';
import { markDeliveriesDue, pollTracking, writePayoutsDue } from './fulfillment.js';
import { pollEbayOrders } from './ebayIngest.js';
import { cancelOrder, processOrder } from './orderPipeline.js';
import { runSync } from './syncService.js';

export interface Jobs {
  /** Price/stock sweep for every account (mock: drifts the supplier first so there is work to do). */
  sync(now?: Date): Promise<void>;
  /**
   * Re-run the pipeline for queued orders (after midnight or when the cap was raised), FIFO, and for
   * orders stuck in `checking` (a request died mid-pipeline, e.g. the supplier call threw).
   */
  drainQueue(now?: Date): Promise<void>;
  /** Cancel held orders past their deadline (no_decision). Never touches awaiting_supplier: those wait for the seller. */
  cancelExpiredHolds(now?: Date): Promise<void>;
  /** Poll tracking for ordered orders; mock delivery; payouts due. */
  runTrackingPoll(now?: Date): Promise<void>;
  /** Real mode only: import new paid eBay orders (GET /order since the cursor) and run them through the pipeline. */
  pollEbayOrders(now?: Date): Promise<void>;
  /** All of the above except sync (the per-tick work). */
  tick(now?: Date): Promise<void>;
}

/** An order left in `checking` this long is assumed abandoned by its request and re-run by the drain. */
export const STUCK_CHECKING_MS = 60_000;

export function buildJobs(db: Db, connectors: Connectors, config: AppConfig, log?: FastifyBaseLogger): Jobs {
  const accounts = (): Promise<Account[]> => db.account.findMany();
  const safe = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      log?.error({ err, job: name }, 'scheduled job failed');
    }
  };

  const jobs: Jobs = {
    async sync(now = new Date()) {
      connectors.mockSupplier?.drift();
      for (const a of await accounts()) await safe(`sync:${a.id}`, async () => void (await runSync(db, connectors, a)));
      void now;
    },
    async drainQueue(now = new Date()) {
      const stuckBefore = new Date(now.getTime() - STUCK_CHECKING_MS);
      for (const a of await accounts()) {
        const queued = await db.order.findMany({
          where: { accountId: a.id, OR: [{ status: 'queued' }, { status: 'checking', updatedAt: { lte: stuckBefore } }] },
          orderBy: { createdAt: 'asc' },
        });
        for (const o of queued) await safe(`drain:${o.id}`, async () => void (await processOrder(db, connectors, a, o.id, now)));
      }
    },
    async cancelExpiredHolds(now = new Date()) {
      for (const a of await accounts()) {
        const expired = await db.order.findMany({ where: { accountId: a.id, status: 'held', holdDeadline: { lte: now } } });
        for (const o of expired) await safe(`expire:${o.id}`, async () => void (await cancelOrder(db, connectors, a, o.id, 'no_decision', { decision: { action: 'cancel', reason: 'no_decision' } })));
      }
    },
    async runTrackingPoll(now = new Date()) {
      for (const a of await accounts()) {
        await safe(`tracking:${a.id}`, async () => void (await pollTracking(db, connectors, a, now)));
        if (config.mode === 'mock') await safe(`delivery:${a.id}`, async () => void (await markDeliveriesDue(db, connectors, a, config.mockDeliveryDelayMs, now)));
        await safe(`payout:${a.id}`, async () => void (await writePayoutsDue(db, a, now)));
      }
    },
    async pollEbayOrders(now = new Date()) {
      if (connectors.mode !== 'real') return;
      for (const a of await accounts()) {
        await safe(`ebay-orders:${a.id}`, async () => {
          const r = await pollEbayOrders(db, connectors, a, now);
          if (r && (r.created > 0 || r.failed > 0)) log?.info({ ...r }, 'eBay order poll');
        });
      }
    },
    async tick(now = new Date()) {
      await jobs.drainQueue(now);
      await jobs.cancelExpiredHolds(now);
      await jobs.runTrackingPoll(now);
    },
  };
  return jobs;
}

export interface SchedulerHandle {
  stop(): void;
}

/** setInterval-based in-process scheduler. Disabled under NODE_ENV=test (config.schedulerEnabled). */
export function startScheduler(jobs: Jobs, config: AppConfig, log?: FastifyBaseLogger): SchedulerHandle {
  if (!config.schedulerEnabled) return { stop: () => undefined };
  let busy = false;
  const guarded = (name: string, fn: () => Promise<void>) => async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      // setInterval callbacks have no caller to reject to: an unhandled rejection would take the process down.
      log?.error({ err, job: name }, 'scheduled job failed');
    } finally {
      busy = false;
    }
  };
  const tickTimer = setInterval(guarded('tick', () => jobs.tick()), config.schedulerTickMs);
  const syncTimer = setInterval(guarded('sync', () => jobs.sync()), config.syncIntervalMs);
  const pollTimer = config.mode === 'real' ? setInterval(guarded('ebay-orders', () => jobs.pollEbayOrders()), config.orderPollIntervalMs) : null;
  tickTimer.unref();
  syncTimer.unref();
  pollTimer?.unref();
  log?.info({ tickMs: config.schedulerTickMs, syncMs: config.syncIntervalMs }, 'scheduler started');
  return {
    stop() {
      clearInterval(tickTimer);
      clearInterval(syncTimer);
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}
