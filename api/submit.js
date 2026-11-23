// POST /api/submit — one FINAL ranking per X handle.
// GET  /api/submit?handle=@x — poll-open state + whether that handle
//      has already submitted (and, if so, their saved order, view-only).
// GET  /api/submit (no handle) — { open } only.
'use strict';

const lib = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost');
      const meta = await lib.getMeta();
      const handle = lib.sanitizeHandle(url.searchParams.get('handle') || '');
      if (!handle) return lib.send(res, 200, { open: meta.open });
      const sub = await lib.getSubmission(handle);
      return lib.send(res, 200, {
        open: meta.open,
        submitted: !!sub,
        submission: sub ? { handle: sub.handle, order: sub.order, updatedAt: sub.updatedAt } : null,
      });
    }

    if (req.method !== 'POST') return lib.send(res, 405, { error: 'Method not allowed.' });

    const body = await lib.readJsonBody(req);
    const handle = lib.sanitizeHandle(body.handle);
    if (!handle) {
      return lib.send(res, 400, { error: 'Enter a valid X handle (letters, numbers, underscore, up to 15 characters).' });
    }
    const teams = lib.loadTeams();
    const check = lib.validateOrder(body.order, teams);
    if (!check.ok) return lib.send(res, 400, { error: check.error });

    const meta = await lib.getMeta();
    if (!meta.open) {
      return lib.send(res, 403, { error: 'The poll is closed right now.' });
    }
    const existing = await lib.getSubmission(handle);
    if (existing) {
      return lib.send(res, 409, { error: 'That handle already submitted — one submission per handle, and it is final.' });
    }
    const sub = { handle, order: body.order, updatedAt: new Date().toISOString() };
    await lib.putSubmission(sub);
    return lib.send(res, 200, { ok: true, final: true, handle, updatedAt: sub.updatedAt });
  } catch (e) {
    return lib.send(res, e.status || 500, { error: e.message || 'Server error.' });
  }
};
