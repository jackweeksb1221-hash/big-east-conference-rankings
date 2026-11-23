// Shared logic for the Big East Conference Rankings API.
// Pure functions (no Blob dependency) so they can be unit-tested locally.
// Storage is a small injectable interface so tests can use an in-memory fake.
//
// Blob layout (Vercel Blob store "big-east-rankings-ballots", private):
//   meta.json                  { open: true, excluded: ["handle", ...] }
//   submissions/<handle>.json  { handle, order: [teamId x11], updatedAt }
// No secrets are ever stored in the repo. ADMIN_PASSWORD is the only
// required environment variable. Blob auth: when BLOB_STORE_ID is set
// (Vercel sets it for a connected store) the @vercel/blob SDK prefers
// OIDC, so realBlobImpl() passes BLOB_READ_WRITE_TOKEN EXPLICITLY (via
// the `token` option) to every SDK call. And put() must use
// access: 'public' — every @vercel/blob version (0.x and 1.x) throws
// `access must be "public"` for 'private' before any network call;
// the real privacy comes from the STORE (big-east-rankings-ballots is
// private), so blobs stay private. When no token is set the SDK falls
// back to its default (OIDC), so reads keep working.
'use strict';

const fs = require('fs');
const path = require('path');

const META_PATH = 'meta.json';
const SUBMISSION_PREFIX = 'submissions/';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// AP-style points: 11 for 1st, 10 for 2nd, down to 1 for 11th.
function pointsForRank(rank) {
  return 12 - rank;
}

// X handles: letters, digits, underscore, 1-15 chars. Strips a leading @.
function sanitizeHandle(raw) {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(h)) return null;
  return h;
}

// order must be exactly the 11 team ids, each once, no extras.
function validateOrder(order, teams) {
  if (!Array.isArray(order) || order.length !== teams.length) {
    return { ok: false, error: 'Ranking must include all ' + teams.length + ' teams.' };
  }
  const known = new Set(teams.map((t) => t.id));
  const seen = new Set();
  for (const id of order) {
    if (typeof id !== 'string' || !known.has(id)) {
      return { ok: false, error: 'Unknown team id: ' + id };
    }
    if (seen.has(id)) return { ok: false, error: 'Duplicate team in ranking: ' + id };
    seen.add(id);
  }
  return { ok: true };
}

// submissions: [{handle, order:[teamId...]}]
// excluded: Set of handles to leave out of the composite.
// Returns rows sorted by points desc, then first-place votes desc,
// then average rank asc, then team name asc.
function computeComposite(teams, submissions, excluded) {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const stats = new Map();
  for (const t of teams) {
    stats.set(t.id, { teamId: t.id, name: t.name, short: t.short, points: 0, firstPlace: 0, ballots: 0, rankSum: 0 });
  }
  let counted = 0;
  for (const s of submissions || []) {
    if (!s || !Array.isArray(s.order)) continue;
    if (excluded && excluded.has(s.handle)) continue;
    counted++;
    s.order.forEach((teamId, i) => {
      const row = stats.get(teamId);
      if (!row) return;
      row.points += pointsForRank(i + 1);
      if (i === 0) row.firstPlace += 1;
      row.ballots += 1;
      row.rankSum += i + 1;
    });
  }
  const rows = [...stats.values()].map((r) => ({
    teamId: r.teamId,
    name: r.name,
    short: r.short,
    points: r.points,
    firstPlace: r.firstPlace,
    ballots: r.ballots,
    avgRank: r.ballots ? +(r.rankSum / r.ballots).toFixed(2) : null,
  }));
  rows.sort((a, b) =>
    b.points - a.points ||
    b.firstPlace - a.firstPlace ||
    (a.avgRank ?? 99) - (b.avgRank ?? 99) ||
    (a.name < b.name ? -1 : 1));
  return { rows, ballotCount: counted };
}

// ---------------------------------------------------------------------------
// Admin password (env var only — never hardcoded, never committed)
// ---------------------------------------------------------------------------

function checkAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, status: 503, error: 'ADMIN_PASSWORD is not configured on the server.' };
  }
  if (typeof password !== 'string' || password !== expected) {
    return { ok: false, status: 401, error: 'Wrong admin password — the poll tools stay locked.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Blob storage (injectable for tests)
// ---------------------------------------------------------------------------

// Impl interface: { put(path, text), get(path) -> text|null, list(prefix) -> [paths], del(path) }
let blobImpl = null;
function setBlobImpl(impl) { blobImpl = impl; }

function realBlobImpl() {
  // Lazy require so unit tests never need @vercel/blob installed.
  const blob = require('@vercel/blob');
  // Pass the read-write token EXPLICITLY to every SDK call. The SDK
  // prefers OIDC when BLOB_STORE_ID is set; the explicit token wins.
  // NOTE: @vercel/blob's put() requires access: 'public' — the option is
  // a client-side validation, and the real privacy comes from the STORE
  // (big-east-rankings-ballots is private), so blobs stay private.
  // access: 'private' throws `Vercel Blob: access must be "public"`
  // before any network call, in every SDK version. Undefined when unset,
  // so the SDK falls back to OIDC.
  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  return {
    async put(p, text) {
      await blob.put(p, text, { access: 'public', addRandomSuffix: false, token });
    },
    async get(p) {
      try {
        const head = await blob.head(p, { token });
        const url = head.downloadUrl || head.url;
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.text();
      } catch (e) {
        return null;
      }
    },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const page = await blob.list({ prefix, cursor, token });
        for (const b of page.blobs) out.push(b.pathname);
        cursor = page.cursor;
      } while (cursor);
      return out;
    },
    async del(p) {
      try {
        const head = await blob.head(p, { token });
        await blob.del(head.url, { token });
      } catch (e) { /* already gone */ }
    },
  };
}

function store() {
  if (blobImpl) return blobImpl;
  // No BLOB_READ_WRITE_TOKEN check here on purpose: a missing token is
  // not fatal — realBlobImpl() passes it explicitly when set and falls
  // back to the SDK default (OIDC) when unset, so reads keep working.
  blobImpl = realBlobImpl();
  return blobImpl;
}

async function getMeta() {
  const raw = await store().get(META_PATH);
  if (!raw) return { open: true, excluded: [] };
  try {
    const m = JSON.parse(raw);
    return { open: m.open !== false, excluded: Array.isArray(m.excluded) ? m.excluded : [] };
  } catch (e) {
    return { open: true, excluded: [] };
  }
}

async function putMeta(meta) {
  await store().put(META_PATH, JSON.stringify({ open: !!meta.open, excluded: meta.excluded || [] }));
}

async function getSubmission(handle) {
  const raw = await store().get(SUBMISSION_PREFIX + handle + '.json');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function putSubmission(sub) {
  await store().put(SUBMISSION_PREFIX + sub.handle + '.json', JSON.stringify(sub));
}

async function listSubmissions() {
  const paths = await store().list(SUBMISSION_PREFIX);
  const out = [];
  for (const p of paths) {
    const raw = await store().get(p);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch (e) { /* skip corrupt */ }
  }
  out.sort((a, b) => (a.handle < b.handle ? -1 : 1));
  return out;
}

async function deleteSubmission(handle) {
  await store().del(SUBMISSION_PREFIX + handle + '.json');
}

async function clearSubmissions() {
  const paths = await store().list(SUBMISSION_PREFIX);
  for (const p of paths) await store().del(p);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { return {}; }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function loadTeams() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'teams.json'), 'utf8');
  return JSON.parse(raw).teams;
}

module.exports = {
  META_PATH, SUBMISSION_PREFIX,
  pointsForRank, sanitizeHandle, validateOrder, computeComposite,
  checkAdminPassword, setBlobImpl, store,
  getMeta, putMeta, getSubmission, putSubmission, listSubmissions,
  deleteSubmission, clearSubmissions, readJsonBody, send, loadTeams,
};
