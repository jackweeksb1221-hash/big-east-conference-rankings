// POST /api/admin — password-gated admin actions.
// Body: { password, action, ... }
// Actions:
//   verify            -> { ok: true } when the password is right
//   setOpen {open}    -> open or close the poll
//   setIncluded {handle, included} -> include/exclude one submission
//   remove {handle}   -> delete one submission (frees the handle)
//   clearAll {confirm:true} -> delete every submission
// Every action re-checks the password server-side.
'use strict';

const lib = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return lib.send(res, 405, { error: 'Method not allowed.' });
    const body = await lib.readJsonBody(req);
    const auth = lib.checkAdminPassword(body.password);
    if (!auth.ok) return lib.send(res, auth.status, { error: auth.error });

    const meta = await lib.getMeta();
    switch (body.action) {
      case 'verify':
        return lib.send(res, 200, { ok: true });
      case 'setOpen': {
        meta.open = body.open !== false;
        await lib.putMeta(meta);
        return lib.send(res, 200, { ok: true, open: meta.open });
      }
      case 'setIncluded': {
        const handle = lib.sanitizeHandle(body.handle);
        if (!handle) return lib.send(res, 400, { error: 'Bad handle.' });
        const excluded = new Set(meta.excluded || []);
        if (body.included === false) excluded.add(handle);
        else excluded.delete(handle);
        meta.excluded = [...excluded];
        await lib.putMeta(meta);
        return lib.send(res, 200, { ok: true, included: body.included !== false });
      }
      case 'remove': {
        const handle = lib.sanitizeHandle(body.handle);
        if (!handle) return lib.send(res, 400, { error: 'Bad handle.' });
        await lib.deleteSubmission(handle);
        meta.excluded = (meta.excluded || []).filter((h) => h !== handle);
        await lib.putMeta(meta);
        return lib.send(res, 200, { ok: true, removed: handle });
      }
      case 'clearAll': {
        if (body.confirm !== true) {
          return lib.send(res, 400, { error: 'Clear all needs confirm: true.' });
        }
        await lib.clearSubmissions();
        meta.excluded = [];
        await lib.putMeta(meta);
        return lib.send(res, 200, { ok: true, cleared: true });
      }
      default:
        return lib.send(res, 400, { error: 'Unknown action: ' + body.action });
    }
  } catch (e) {
    return lib.send(res, e.status || 500, { error: e.message || 'Server error.' });
  }
};
