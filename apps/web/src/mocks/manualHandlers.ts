import { http, HttpResponse, delay } from 'msw';
import * as m from './manualStore';

const B = '/api/v1';
const latency = () => delay(import.meta.env.MODE === 'test' ? 0 : 180);

/** Runs `fn`, turning an ApiErr into the contract's `{ error: { code, message, details? } }` response. */
async function respond(fn: () => unknown, status = 200): Promise<Response> {
  await latency();
  try {
    const out = fn();
    return out === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(out as object, { status });
  } catch (e) {
    if (e instanceof m.ApiErr) return HttpResponse.json({ error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } }, { status: e.status });
    throw e;
  }
}

const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

export const manualHandlers = [
  http.get(`${B}/manual-products`, () => respond(() => { const items = m.listManual(); return { items, total: items.length }; })),
  http.post(`${B}/manual-products`, async ({ request }) => { const b = await body(request); return respond(() => m.createManual(b), 201); }),
  http.patch(`${B}/manual-products/:id`, async ({ request, params }) => { const b = await body(request); return respond(() => m.patchManual(String(params.id), b)); }),
  http.delete(`${B}/manual-products/:id`, ({ params }) => respond(() => { m.deleteManual(String(params.id)); return undefined; })),

  http.post(`${B}/orders/:id/supplier-quote`, async ({ request, params }) => { const b = await body(request); return respond(() => m.quote(String(params.id), b)); }),
  http.post(`${B}/orders/:id/supplier-order`, async ({ request, params }) => { const b = await body(request); return respond(() => m.recordSupplierOrder(String(params.id), b)); }),
  http.post(`${B}/orders/:id/tracking`, async ({ request, params }) => { const b = await body(request); return respond(() => m.addTracking(String(params.id), b)); }),
  http.post(`${B}/orders/:id/delivered`, ({ params }) => respond(() => m.markDelivered(String(params.id)))),
];
