// GET /api/composite — password-gated admin read.
// Password via ?password=... or the x-admin-password header.
// Returns poll state, the submission checklist, and the composite ranking
// compiled from checked-in accounts only (AP-style points).
'use strict';

const lib = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return lib.send(res, 405, { error: 'Method not allowed.' });
    const url = new URL(req.url || '/', 'http://localhost');
    const password = url.searchParams.get('password') || req.headers['x-admin-password'];
    const auth = lib.checkAdminPassword(password);
    if (!auth.ok) return lib.send(res, auth.status, { error: auth.error });

    const teams = lib.loadTeams();
    const meta = await lib.getMeta();
    const excluded = new Set(meta.excluded || []);
    const submissions = await lib.listSubmissions();
    const byId = new Map(teams.map((t) => [t.id, t]));
    const composite = lib.computeComposite(teams, submissions, excluded);
    const checklist = submissions.map((s) => ({
      handle: s.handle,
      updatedAt: s.updatedAt,
      firstPick: byId.get(s.order && s.order[0]) ? byId.get(s.order[0]).short : null,
      firstPickId: s.order && s.order[0],
      included: !excluded.has(s.handle),
    }));
    return lib.send(res, 200, {
      open: meta.open,
      ballotCount: composite.ballotCount,
      submissions: checklist,
      composite: composite.rows,
    });
  } catch (e) {
    return lib.send(res, e.status || 500, { error: e.message || 'Server error.' });
  }
};
