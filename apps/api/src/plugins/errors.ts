import { NotConfiguredError } from '@floor/core';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Maps every thrown error to the contract shape { error: { code, message } }. */
export const errorPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((req, reply) => {
    const body: ErrorBody = { error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } };
    void reply.code(404).send(body);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    let status = 500;
    let body: ErrorBody = { error: { code: 'INTERNAL', message: 'Internal server error' } };

    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { error: { code: 'VALIDATION', message: 'Invalid request', details: err.issues } };
    } else if (err instanceof NotConfiguredError) {
      status = 501;
      body = { error: { code: err.code, message: err.message, details: { missing: err.missing } } };
    } else if (isFastifyError(err)) {
      status = err.statusCode ?? 500;
      // Fastify's own codes (FST_ERR_CTP_* for bad bodies, etc.) are not contract codes.
      const code = err.code && !err.code.startsWith('FST_ERR_') ? err.code : status === 400 || status === 413 || status === 415 ? 'BAD_REQUEST' : 'INTERNAL';
      body = { error: { code, message: err.message } };
    }

    if (status >= 500) req.log.error({ err }, 'request failed');
    void reply.code(status).send(body);
  });
}, { name: 'errors' });

function isFastifyError(e: unknown): e is Error & { statusCode?: number; code?: string } {
  return e instanceof Error && ('statusCode' in e || 'code' in e);
}
