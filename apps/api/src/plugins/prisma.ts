import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

/** Attach a (pre-created) Prisma client to the instance and disconnect on close. */
export const prismaPlugin = fp(async (app: FastifyInstance, opts: { db: Db }) => {
  app.decorate('db', opts.db);
  app.addHook('onClose', async () => {
    await opts.db.$disconnect();
  });
}, { name: 'prisma' });
