// Vercel serverless function: the app's own login + data API.
// Passwords are hashed here (scrypt). Supabase is used only as a database,
// reached with a secret key that lives in Vercel environment variables.
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = process.env.APP_SECRET || '';
const DEFCATS = ['Dress', 'Food', 'Electronics', 'Petrol', 'EMI', 'Other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAME = /^[a-z0-9._]{3,30}$/;

function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function num(v, min, max) { const n = Number(v); if (!isFinite(n) || n < min || n > max) fail(400, 'Invalid amount.'); return Math.round(n * 100) / 100; }
function uuid(v) { if (!UUID.test(String(v))) fail(400, 'Invalid id.'); return String(v); }
function uname(v) { const u = str(v, 30).toLowerCase(); if (!UNAME.test(u)) fail(400, 'Username: 3 to 30 characters, using letters, numbers, dots or underscores.'); return u; }
function q(v) { return encodeURIComponent(v); }

/* ---------- session tokens (HS256, signed with APP_SECRET) ---------- */
function b64u(x) { return Buffer.from(x).toString('base64url'); }
function mac(data) { return crypto.createHmac('sha256', SECRET).update(data).digest(); }
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(payload));
  return h + '.' + p + '.' + mac(h + '.' + p).toString('base64url');
}
function verify(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  const want = mac(parts[0] + '.' + parts[1]), got = Buffer.from(parts[2], 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p; try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch (e) { return null; }
  if (!p.exp || p.exp < Date.now() / 1000 || !UUID.test(String(p.uid))) return null;
  return p;
}
function pub(u) { return { id: u.id, name: u.name, email: u.email || '', username: u.username || '' }; }
function session(u) {
  return { token: sign({ uid: u.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }), user: pub(u) };
}

/* ---------- database (Supabase REST, server-side only) ---------- */
async function db(method, path, body, prefer) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' };
  if (SB_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SB_KEY;
  const r = await fetch(SB_URL + '/rest/v1/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.message) || 'Database error ' + r.status); e.db = true; throw e; }
  return j;
}
const MIN = 'return=minimal';

/* ---------- accounts: sign in with username OR email ---------- */
async function findUser(id) {
  id = str(id, 200).toLowerCase();
  if (!id) return null;
  const col = id.includes('@') ? 'email' : 'username';
  return (await db('GET', 'app_users?select=*&' + col + '=eq.' + q(id)))[0] || null;
}
async function register(b) {
  const name = str(b.name, 60), username = uname(b.username), email = str(b.email, 200).toLowerCase(), pw = String(b.password || '');
  if (!name) fail(400, 'Enter your name.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address, or leave it blank.');
  if (pw.length < 8 || pw.length > 200) fail(400, 'Password must be 8 to 200 characters.');
  if ((await db('GET', 'app_users?select=id&username=eq.' + q(username))).length) fail(409, 'That username is taken. Try another.');
  if (email && (await db('GET', 'app_users?select=id&email=eq.' + q(email))).length) fail(409, 'That email already has an account. Sign in instead.');
  const salt = crypto.randomBytes(16), hash = await scrypt(pw, salt, 64);
  let u;
  try { u = (await db('POST', 'app_users', { name, username, email: email || null, salt: salt.toString('hex'), hash: hash.toString('hex') }))[0]; }
  catch (e) { if (e.db && /duplicate|unique/i.test(e.message)) fail(409, 'That username or email is already in use.'); throw e; }
  await db('POST', 'settings', { user_id: u.id, salary: 0 }, MIN);
  await db('POST', 'categories', DEFCATS.map(n => ({ user_id: u.id, name: n, budget: 0 })), MIN);
  return session(u);
}
async function login(b) {
  const pw = String(b.password || '');
  const u = await findUser(b.login || b.email || b.username);
  if (!u) { await scrypt(pw, Buffer.alloc(16), 64); fail(401, 'Username/email or password is wrong.'); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) fail(429, 'Too many wrong attempts. Try again in 15 minutes.');
  const h = await scrypt(pw, Buffer.from(u.salt, 'hex'), 64);
  if (!crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'))) {
    const f = (u.failed_logins || 0) + 1;
    await db('PATCH', 'app_users?id=eq.' + u.id, { failed_logins: f >= 5 ? 0 : f, locked_until: f >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null }, MIN);
    fail(401, 'Username/email or password is wrong.');
  }
  if (u.failed_logins || u.locked_until) await db('PATCH', 'app_users?id=eq.' + u.id, { failed_logins: 0, locked_until: null }, MIN);
  return session(u);
}

/* ---------- data ---------- */
async function load(uid) {
  const [u, s, c, t, r] = await Promise.all([
    db('GET', 'app_users?select=id,name,email,username&id=eq.' + uid),
    db('GET', 'settings?select=salary,carry,goal_name,goal_target&user_id=eq.' + uid),
    db('GET', 'categories?select=id,name,budget&user_id=eq.' + uid + '&order=created_at.asc'),
    db('GET', 'transactions?select=*&user_id=eq.' + uid + '&order=tx_date.desc&limit=10000'),
    db('GET', 'recurring?select=*&user_id=eq.' + uid + '&order=created_at.asc')]);
  if (!u.length) fail(401, 'Please sign in again.');
  const st = s[0] || {};
  return {
    user: pub(u[0]), salary: Number(st.salary) || 0,
    prefs: { carry: !!st.carry, goalName: st.goal_name || '', goalTarget: Number(st.goal_target) || 0 },
    cats: c.map(x => ({ id: x.id, n: x.name, bud: Number(x.budget) })),
    tx: t.map(x => ({ id: x.id, d: x.tx_date, t: x.kind === 'saving' ? 'Saving' : 'Expense', c: x.category, a: Number(x.amount), s: x.description || '', p: x.paid_with || '', r: x.recurring_id || null })),
    rec: r.map(x => ({ id: x.id, n: x.name, t: x.kind === 'saving' ? 'Saving' : 'Expense', c: x.category, a: Number(x.amount), p: x.paid_with || 'UPI', day: x.day || 1 }))
  };
}

function txRow(b) {
  const d = str(b.date, 10), kind = b.kind === 'saving' ? 'saving' : b.kind === 'expense' ? 'expense' : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !kind) fail(400, 'Invalid entry.');
  const category = str(b.category, 60); if (!category) fail(400, 'Choose a category.');
  return {
    tx_date: d, kind, category, amount: num(b.amount, 0.01, 1e12),
    description: str(b.description, 200), paid_with: str(b.paid, 30),
    recurring_id: b.rid && UUID.test(String(b.rid)) ? String(b.rid) : null
  };
}
function recRow(b) {
  const name = str(b.name, 60); if (!name) fail(400, 'Enter a name.');
  const kind = b.kind === 'saving' ? 'saving' : 'expense';
  const day = Math.min(28, Math.max(1, parseInt(b.day, 10) || 1));
  return { name, kind, category: str(b.category, 60) || (kind === 'saving' ? 'Savings' : 'Other'), amount: num(b.amount, 0.01, 1e12), paid_with: str(b.paid, 30) || 'UPI', day };
}

async function restore(uid, b) {
  const cats = Array.isArray(b.cats) ? b.cats.slice(0, 200) : [], tx = Array.isArray(b.tx) ? b.tx : [], rec = Array.isArray(b.rec) ? b.rec.slice(0, 100) : [];
  if (tx.length > 10000) fail(400, 'Backup is too large (over 10,000 entries).');
  const seen = new Set(), catRows = [];
  cats.forEach(c => { const n = str(c.n, 60), k = n.toLowerCase(); if (n && !seen.has(k)) { seen.add(k); catRows.push({ user_id: uid, name: n, budget: num(c.bud || 0, 0, 1e12) }); } });
  const recRows = rec.map(r => Object.assign({ user_id: uid }, recRow({ name: r.n, kind: r.t === 'Saving' ? 'saving' : 'expense', category: r.c, amount: r.a, paid: r.p, day: r.day })));
  // validate every entry before touching the database
  const txRows = tx.map(x => ({ key: x.r, row: txRow({ date: x.d, kind: x.t === 'Saving' ? 'saving' : 'expense', category: x.c, amount: x.a, description: x.s, paid: x.p }) }));

  await db('DELETE', 'transactions?user_id=eq.' + uid, undefined, MIN);
  await db('DELETE', 'recurring?user_id=eq.' + uid, undefined, MIN);
  await db('DELETE', 'categories?user_id=eq.' + uid, undefined, MIN);
  await db('PATCH', 'settings?user_id=eq.' + uid, {
    salary: num(b.salary || 0, 0, 1e12), carry: !!(b.prefs && b.prefs.carry),
    goal_name: str(b.prefs && b.prefs.goalName, 60), goal_target: num((b.prefs && b.prefs.goalTarget) || 0, 0, 1e12)
  }, MIN);
  if (catRows.length) await db('POST', 'categories', catRows, MIN);
  const map = {};
  if (recRows.length) {
    const made = await db('POST', 'recurring', recRows);
    made.forEach((m, i) => { if (rec[i].key) map[rec[i].key] = m.id; });
  }
  for (let i = 0; i < txRows.length; i += 1000) {
    const chunk = txRows.slice(i, i + 1000).map(x => Object.assign({ user_id: uid }, x.row, { recurring_id: (x.key && map[x.key]) || null }));
    await db('POST', 'transactions', chunk, MIN);
  }
  return { ok: true, count: txRows.length };
}

async function route(b, req) {
  const a = b.action;
  if (a === 'ping') return { ok: true };
  if (a === 'register') return register(b);
  if (a === 'login') return login(b);
  const claims = verify((req.headers.authorization || '').replace(/^Bearer /i, ''));
  if (!claims) fail(401, 'Please sign in again.');
  const uid = claims.uid;
  switch (a) {
    case 'load': return load(uid);
    case 'setSalary':
      await db('POST', 'settings?on_conflict=user_id', { user_id: uid, salary: num(b.salary, 0, 1e12) }, 'resolution=merge-duplicates,return=minimal');
      return { ok: true };
    case 'setPrefs':
      await db('PATCH', 'settings?user_id=eq.' + uid, { carry: !!b.carry, goal_name: str(b.goalName, 60), goal_target: num(b.goalTarget || 0, 0, 1e12) }, MIN);
      return { ok: true };
    case 'setUsername': {
      const u = uname(b.username);
      const ex = await db('GET', 'app_users?select=id&username=eq.' + q(u));
      if (ex.length && ex[0].id !== uid) fail(409, 'That username is taken. Try another.');
      await db('PATCH', 'app_users?id=eq.' + uid, { username: u }, MIN);
      return { ok: true };
    }
    case 'addTx':
      await db('POST', 'transactions', Object.assign({ user_id: uid }, txRow(b)), MIN);
      return { ok: true };
    case 'addTxs': {
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length || items.length > 100) fail(400, 'Invalid entries.');
      await db('POST', 'transactions', items.map(x => Object.assign({ user_id: uid }, txRow(x))), MIN);
      return { ok: true };
    }
    case 'editTx': {
      const row = txRow(b); delete row.recurring_id;
      await db('PATCH', 'transactions?id=eq.' + uuid(b.id) + '&user_id=eq.' + uid, row, MIN);
      return { ok: true };
    }
    case 'delTx': await db('DELETE', 'transactions?id=eq.' + uuid(b.id) + '&user_id=eq.' + uid, undefined, MIN); return { ok: true };
    case 'addCat': {
      const name = str(b.name, 60); if (!name) fail(400, 'Enter a category name.');
      try { await db('POST', 'categories', { user_id: uid, name, budget: num(b.budget || 0, 0, 1e12) }, MIN); }
      catch (e) { if (e.db && /duplicate|unique/i.test(e.message)) fail(409, 'That category already exists.'); throw e; }
      return { ok: true };
    }
    case 'setBud': await db('PATCH', 'categories?id=eq.' + uuid(b.id) + '&user_id=eq.' + uid, { budget: num(b.budget, 0, 1e12) }, MIN); return { ok: true };
    case 'delCat': await db('DELETE', 'categories?id=eq.' + uuid(b.id) + '&user_id=eq.' + uid, undefined, MIN); return { ok: true };
    case 'addRec': {
      const n = await db('GET', 'recurring?select=id&user_id=eq.' + uid);
      if (n.length >= 100) fail(400, 'You can keep up to 100 recurring items.');
      await db('POST', 'recurring', Object.assign({ user_id: uid }, recRow(b)), MIN);
      return { ok: true };
    }
    case 'delRec': await db('DELETE', 'recurring?id=eq.' + uuid(b.id) + '&user_id=eq.' + uid, undefined, MIN); return { ok: true };
    case 'restore': return restore(uid, b);
    default: fail(400, 'Unknown action.');
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!SB_URL || !SB_KEY || SECRET.length < 16) return res.status(503).json({ error: 'not_configured' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    res.status(200).json(await route(b, req));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
