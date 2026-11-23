// Local tests for the Big East Conference Rankings app.
// Run: node test/test-rankings.js
// Handlers run against an in-memory fake Blob store — no Vercel account needed.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const lib = require('../api/_lib');
const submitHandler = require('../api/submit');
const compositeHandler = require('../api/composite');
const adminHandler = require('../api/admin');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); fail++; }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); fail++; }
}

// --- In-memory fake Blob store ---
function fakeBlob() {
  const m = new Map();
  return {
    async put(p, text) { m.set(p, text); },
    async get(p) { return m.has(p) ? m.get(p) : null; },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
    async del(p) { m.delete(p); },
    _map: m,
  };
}
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (t) => { res.body = t; };
  return res;
}
async function call(handler, { method = 'GET', url = '/', body = undefined, headers = {} } = {}) {
  const req = { method, url, body, headers };
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

const TEAMS = lib.loadTeams();
const ORDER = TEAMS.map((t) => t.id); // by record: Georgetown, DePaul, St John's, ...
const REVERSED = [...ORDER].reverse();

(async () => {
  console.log('== pure functions ==');
  check('points: 1st=11, 2nd=10, 11th=1', () => {
    assert.strictEqual(lib.pointsForRank(1), 11);
    assert.strictEqual(lib.pointsForRank(2), 10);
    assert.strictEqual(lib.pointsForRank(11), 1);
  });
  check('sanitizeHandle strips @, lowercases, rejects spaces', () => {
    assert.strictEqual(lib.sanitizeHandle('@Jack_1'), 'jack_1');
    assert.strictEqual(lib.sanitizeHandle('Bad Handle'), null);
    assert.strictEqual(lib.sanitizeHandle(''), null);
    assert.strictEqual(lib.sanitizeHandle('toolonghandle123456'), null);
  });
  check('validateOrder: ok / duplicate / missing / unknown', () => {
    assert.strictEqual(lib.validateOrder(ORDER, TEAMS).ok, true);
    assert.strictEqual(lib.validateOrder([...ORDER.slice(0, 10), ORDER[0]], TEAMS).ok, false);
    assert.strictEqual(lib.validateOrder(ORDER.slice(0, 10), TEAMS).ok, false);
    assert.strictEqual(lib.validateOrder([...ORDER.slice(0, 10), 'nope'], TEAMS).ok, false);
  });
  check('composite: points + first-place tiebreak', () => {
    // A: Georgetown 1st, DePaul 2nd, St John's 3rd, rest in record order.
    // B: St John's 1st, DePaul 2nd, Georgetown 3rd, rest in record order.
    const rest = ORDER.slice(3);
    const a = { handle: 'a', order: ['georgetown', 'depaul', 'stjohns', ...rest] };
    const b = { handle: 'b', order: ['stjohns', 'depaul', 'georgetown', ...rest] };
    const { rows, ballotCount } = lib.computeComposite(TEAMS, [a, b], new Set());
    assert.strictEqual(ballotCount, 2);
    // Georgetown 11+9=20 (1 fp), St John's 9+11=20 (1 fp), DePaul 10+10=20 (0 fp)
    assert.strictEqual(rows[0].teamId, 'georgetown');
    assert.strictEqual(rows[0].points, 20);
    assert.strictEqual(rows[0].firstPlace, 1);
    assert.strictEqual(rows[1].teamId, 'stjohns');
    assert.strictEqual(rows[1].points, 20);
    assert.strictEqual(rows[1].firstPlace, 1);
    assert.strictEqual(rows[2].teamId, 'depaul');
    assert.strictEqual(rows[2].points, 20);
    assert.strictEqual(rows[2].firstPlace, 0);
  });
  check('composite: excluded ballots contribute nothing', () => {
    const a = { handle: 'a', order: ORDER };
    const { rows, ballotCount } = lib.computeComposite(TEAMS, [a], new Set(['a']));
    assert.strictEqual(ballotCount, 0);
    assert.strictEqual(rows[0].points, 0);
  });

  console.log('== handlers (fake Blob) ==');
  lib.setBlobImpl(fakeBlob());
  process.env.ADMIN_PASSWORD = 'test-admin-123';

  await checkAsync('submit: first ballot accepted, final', async () => {
    const r = await call(submitHandler, { method: 'POST', url: '/api/submit', body: { handle: '@Voter1', order: ORDER } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.final, true);
    assert.strictEqual(r.json.handle, 'voter1');
  });
  await checkAsync('submit: second submit same handle (different casing) rejected 409', async () => {
    const r = await call(submitHandler, { method: 'POST', url: '/api/submit', body: { handle: 'VOTER1', order: REVERSED } });
    assert.strictEqual(r.status, 409);
    assert.match(r.json.error, /already submitted/);
  });
  await checkAsync('submit GET: already-submitted handle loads view-only', async () => {
    const r = await call(submitHandler, { method: 'GET', url: '/api/submit?handle=voter1' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.submitted, true);
    assert.deepStrictEqual(r.json.submission.order, ORDER);
  });
  await checkAsync('composite: wrong password rejected 401', async () => {
    const r = await call(compositeHandler, { method: 'GET', url: '/api/composite?password=nope' });
    assert.strictEqual(r.status, 401);
  });
  await checkAsync('composite: correct password, 1 ballot, Georgetown 11 pts (1)', async () => {
    const r = await call(compositeHandler, { method: 'GET', url: '/api/composite', headers: { 'x-admin-password': 'test-admin-123' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.ballotCount, 1);
    assert.strictEqual(r.json.composite[0].teamId, 'georgetown');
    assert.strictEqual(r.json.composite[0].points, 11);
    assert.strictEqual(r.json.composite[0].firstPlace, 1);
    assert.strictEqual(r.json.submissions[0].handle, 'voter1');
    assert.strictEqual(r.json.submissions[0].firstPick, 'Georgetown');
    assert.strictEqual(r.json.submissions[0].included, true);
  });
  await checkAsync('admin: close poll blocks new submits (403), reopen restores', async () => {
    let r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'setOpen', open: false } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.open, false);
    r = await call(submitHandler, { method: 'POST', url: '/api/submit', body: { handle: 'voter2', order: ORDER } });
    assert.strictEqual(r.status, 403);
    assert.match(r.json.error, /closed/);
    r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'setOpen', open: true } });
    assert.strictEqual(r.json.open, true);
  });
  await checkAsync('include/exclude: second ballot changes composite, excluding removes it', async () => {
    let r = await call(submitHandler, { method: 'POST', url: '/api/submit', body: { handle: 'voter2', order: REVERSED } });
    assert.strictEqual(r.status, 200);
    r = await call(compositeHandler, { method: 'GET', url: '/api/composite', headers: { 'x-admin-password': 'test-admin-123' } });
    assert.strictEqual(r.json.ballotCount, 2);
    // Reversed ballot puts Butler 1st (11) + Georgetown 11th (1) => Georgetown 12, Butler 12
    assert.strictEqual(r.json.composite.find((x) => x.teamId === 'georgetown').points, 12);
    r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'setIncluded', handle: 'voter2', included: false } });
    assert.strictEqual(r.status, 200);
    r = await call(compositeHandler, { method: 'GET', url: '/api/composite', headers: { 'x-admin-password': 'test-admin-123' } });
    assert.strictEqual(r.json.ballotCount, 1);
    assert.strictEqual(r.json.composite.find((x) => x.teamId === 'georgetown').points, 11);
    r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'setIncluded', handle: 'voter2', included: true } });
    assert.strictEqual(r.status, 200);
  });
  await checkAsync('admin remove: frees the handle to submit again', async () => {
    let r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'remove', handle: 'voter2' } });
    assert.strictEqual(r.status, 200);
    r = await call(submitHandler, { method: 'POST', url: '/api/submit', body: { handle: 'voter2', order: ORDER } });
    assert.strictEqual(r.status, 200);
  });
  await checkAsync('admin clearAll: wipes every ballot, composite empty', async () => {
    let r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'clearAll', confirm: true } });
    assert.strictEqual(r.status, 200);
    r = await call(compositeHandler, { method: 'GET', url: '/api/composite', headers: { 'x-admin-password': 'test-admin-123' } });
    assert.strictEqual(r.json.ballotCount, 0);
    assert.deepStrictEqual(r.json.submissions, []);
    assert.strictEqual(r.json.composite[0].points, 0);
  });
  await checkAsync('admin clearAll without confirm is rejected', async () => {
    const r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'clearAll' } });
    assert.strictEqual(r.status, 400);
  });
  await checkAsync('password gating: missing ADMIN_PASSWORD env returns 503', async () => {
    delete process.env.ADMIN_PASSWORD;
    const r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'anything', action: 'verify' } });
    assert.strictEqual(r.status, 503);
    process.env.ADMIN_PASSWORD = 'test-admin-123';
  });
  await checkAsync('admin verify: wrong password 401, right password 200', async () => {
    let r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'wrong', action: 'verify' } });
    assert.strictEqual(r.status, 401);
    r = await call(adminHandler, { method: 'POST', url: '/api/admin', body: { password: 'test-admin-123', action: 'verify' } });
    assert.strictEqual(r.status, 200);
  });

  console.log('== file smoke checks ==');
  check('teams.json has all 11 teams with records as of Nov 23', () => {
    assert.strictEqual(TEAMS.length, 11);
    const g = TEAMS.find((t) => t.id === 'georgetown');
    assert.deepStrictEqual([g.wins, g.losses], [6, 0]);
    const b = TEAMS.find((t) => t.id === 'butler');
    assert.deepStrictEqual([b.wins, b.losses], [4, 3]);
    for (const t of TEAMS) assert.ok(t.logo.startsWith('https://a.espncdn.com/i/teamlogos/ncaa/500/'), t.id);
  });
  check('index.html: submit button at top, admin-only graphic, (N) note, no My-ranking poster', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(html.includes('id="submitTop"'), 'top submit button');
    assert.ok(html.includes('Poll Admin'), 'admin tab');
    assert.ok(html.includes('times it was picked 1st'), '(N) explanation');
    assert.ok(!html.includes('My ranking'), 'no My-ranking switch');
    assert.ok(html.includes('downloadPoster'), 'PNG download');
  });
  check('no secrets in repo (no hardcoded admin password)', () => {
    const files = ['index.html', 'teams.json', 'package.json', 'vercel.json', 'README.md',
      'api/_lib.js', 'api/submit.js', 'api/composite.js', 'api/admin.js', 'scripts/deploy.py'];
    for (const f of files) {
      const txt = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      // No literal password assignment anywhere (env-var references are fine).
      assert.ok(!/ADMIN_PASSWORD\s*=\s*['"][^'"]+['"]/.test(txt), f + ' hardcodes an admin password');
      assert.ok(!/BLOB_READ_WRITE_TOKEN\s*=\s*['"][^'"]+['"]/.test(txt), f + ' leaks a token');
    }
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'api/_lib.js'), 'utf8').includes('process.env.ADMIN_PASSWORD'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
