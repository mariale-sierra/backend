// SOLO PARA ENTORNO LOCAL AISLADO. Nunca apuntar a Azure/producción: crea usuarios, edita la BD por psql y genera carga.
// Requiere: backend compilado corriendo en localhost (3100 limites por defecto / 3101 con THROTTLE_LIMIT alto) y un Postgres desechable en 55440.
// Las rutas absolutas de psql/autocannon son las del equipo donde se ejecuto; ajustalas.
// Security probe suite - runs ONLY against the local, isolated backend instance (http://localhost:3100).
import { execSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3100';
const PSQL = '"C:/Program Files/PostgreSQL/17/bin/psql" -h 127.0.0.1 -p 55440 -U postgres -d havit_sec -tA -c';
const sql = (q) => execSync(`${PSQL} "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const results = [];
const rec = (id, owasp, title, verdict, evidence) => {
  results.push({ id, owasp, title, verdict, evidence });
  console.log(`[${verdict}] ${id} ${owasp} ${title} :: ${evidence}`);
};
async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    text = await res.text();
  } catch (e) {
    return { status: 0, text: String(e), ms: Date.now() - t0, headers: new Headers() };
  }
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, ms: Date.now() - t0, headers: res.headers };
}
async function signUp(tag) {
  const username = `sec_${tag}_${randomUUID().slice(0, 6)}`;
  const email = `${username}@example.com`;
  const password = 'Passw0rd!x';
  const r = await call('POST', '/auth/register', { body: { email, username, password, acceptTerms: true, confirmAge16: true } });
  const id = sql(`SELECT id FROM havit.users WHERE email='${email}'`);
  return { token: r.json?.accessToken, id, email, username, password, status: r.status };
}

// ---------- setup
const A = await signUp('a'), B = await signUp('b'), C = await signUp('c'), ADM = await signUp('adm');
sql(`UPDATE havit.users SET is_admin=true WHERE id='${ADM.id}'`);
sql(`UPDATE havit.user_profiles SET is_private=true WHERE user_id='${B.id}'`);
console.log('users ready', [A, B, C, ADM].map((u) => u.status));

// challenges: A owns a PRIVATE one; B has a private-visibility post
const privChallenge = randomUUID();
sql(`INSERT INTO havit.challenges (id,name,visibility,created_by_user_id,duration_days) VALUES ('${privChallenge}','secret club','private','${A.id}',30)`);
sql(`INSERT INTO havit.challenge_user_map (challenge_id,user_id,role,status) VALUES ('${privChallenge}','${A.id}','owner','active')`);
const pubChallenge = randomUUID();
sql(`INSERT INTO havit.challenges (id,name,visibility,created_by_user_id,duration_days) VALUES ('${pubChallenge}','open club','public','${B.id}',30)`);
sql(`INSERT INTO havit.challenge_user_map (challenge_id,user_id,role,status) VALUES ('${pubChallenge}','${B.id}','owner','active')`);
const bPost = await call('POST', '/workout-logs/progress', { token: B.token, body: { challengeId: pubChallenge, imageUrl: 'https://example.com/b.jpg', visibility: 'private', caption: 'private <script>alert(1)</script> #x' } });
const bPostId = sql(`SELECT id FROM havit.workout_posts WHERE user_id='${B.id}' LIMIT 1`);
const bLogId = sql(`SELECT id FROM havit.workout_logs WHERE user_id='${B.id}' LIMIT 1`);
sql(`UPDATE havit.workout_posts SET moderation_status='approved' WHERE id='${bPostId}'`);

// ---------- A01 Broken access control
{
  const sw = await call('GET', '/api-docs-json');
  const paths = Object.entries(sw.json?.paths ?? {});
  rec('A01-00', 'A01', 'Swagger JSON publicly readable (API map)', sw.status === 200 ? 'FINDING' : 'PASS', `GET /api-docs-json -> ${sw.status}, ${paths.length} paths`);
  const open = [];
  for (const [p, ops] of paths) {
    if (!ops.get || p.includes('{')) continue;
    const r = await call('GET', p);
    if (r.status !== 401) open.push(`${p}:${r.status}`);
  }
  rec('A01-01', 'A01', 'GET endpoints reachable WITHOUT a token', 'INFO', open.join(' ') || 'none');
}
{
  const r = await call('GET', `/challenges/${privChallenge}`);
  rec('A01-02', 'A01', 'Private challenge detail without token', r.status === 200 ? 'FINDING' : 'PASS', `GET /challenges/:privateId (no auth) -> ${r.status}${r.json?.name ? ' name=' + r.json.name : ''}`);
  const m = await call('GET', `/challenges/${privChallenge}/members`, { token: C.token });
  rec('A01-03', 'A01', 'Private challenge member list for a non-member', m.status === 200 ? 'FINDING' : 'PASS', `GET /challenges/:id/members as stranger -> ${m.status}`);
  const a = await call('GET', `/challenges/${privChallenge}/author`);
  rec('A01-04', 'A01', 'Private challenge author endpoint without token', a.status === 200 ? 'FINDING' : 'PASS', `GET /challenges/:id/author -> ${a.status}`);
  const list = await call('GET', '/challenges');
  rec('A01-05', 'A01', 'Challenge list without token leaks private ones?', list.text.includes('secret club') ? 'FINDING' : 'PASS', `GET /challenges (no auth) -> ${list.status}, contains private name: ${list.text.includes('secret club')}`);
}
{
  const t = [
    ['GET', `/workout-logs/${bLogId}`, C.token, 'read another user workout log'],
    ['PATCH', `/workout-logs/${bLogId}/finish`, C.token, 'finish another user workout log'],
    ['DELETE', `/workout-posts/${bPostId}`, C.token, 'delete another user post'],
    ['GET', `/workout-posts/user/${B.id}`, C.token, 'list posts of a private profile'],
    ['GET', `/users/${B.id}/profile`, C.token, 'profile of private user (stranger)'],
    ['GET', `/badges/user/${B.id}`, C.token, 'badges of private user'],
    ['GET', `/workout-posts/${bPostId}/comments`, C.token, 'comments of a private post'],
    ['GET', `/workout-posts/${bPostId}/reactions`, C.token, 'reactions of a private post'],
    ['GET', `/workout-posts/${bPostId}/reactions/users`, C.token, 'who reacted to a private post'],
  ];
  for (const [m, p, tok, label] of t) {
    const r = await call(m, p, { token: tok });
    const ok = [401, 403, 404].includes(r.status) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
    rec('A01-IDOR', 'A01', `IDOR: ${label}`, ok ? 'PASS' : 'FINDING', `${m} ${p} -> ${r.status}${r.status === 200 ? ' body=' + r.text.slice(0, 120) : ''}`);
  }
  const convo = await call('POST', '/chats/conversations', { token: A.token, body: { recipientUserId: B.id } });
  const cid = convo.json?.id;
  if (cid) {
    const m = await call('GET', `/chats/conversations/${cid}/messages`, { token: C.token });
    rec('A01-06', 'A01', 'IDOR: read messages of a conversation you are not in', [403, 404].includes(m.status) ? 'PASS' : 'FINDING', `-> ${m.status}`);
    const s = await call('POST', `/chats/conversations/${cid}/messages`, { token: C.token, body: { content: 'hi' } });
    rec('A01-07', 'A01', 'IDOR: send into a conversation you are not in', [403, 404].includes(s.status) ? 'PASS' : 'FINDING', `-> ${s.status}`);
  }
  const rt = await call('POST', '/routine', { token: B.token, body: { name: 'b routine' } });
  const rid = rt.json?.id;
  if (rid) {
    const g = await call('GET', `/routine/${rid}`, { token: C.token });
    rec('A01-08', 'A01', "IDOR: read another user's routine by id", g.status === 200 ? 'INFO' : 'PASS', `GET /routine/:id as other user -> ${g.status} (routines are shareable via challenges; confirm intent)`);
    const d = await call('DELETE', `/routine/${rid}`, { token: C.token });
    rec('A01-09', 'A01', "IDOR: delete another user's routine", [403, 404].includes(d.status) ? 'PASS' : 'FINDING', `DELETE -> ${d.status}`);
    const add = await call('POST', `/routine/${rid}/exercises`, { token: C.token, body: { exerciseId: 1 } });
    rec('A01-10', 'A01', "IDOR: add exercise to another user's routine", [403, 404].includes(add.status) ? 'PASS' : 'FINDING', `POST -> ${add.status}`);
  }
  const j = await call('POST', `/challenges/${privChallenge}/join`, { token: C.token });
  rec('A01-11', 'A01', 'Join a PRIVATE challenge directly (must go through request)', j.status === 201 && j.json?.status === 'active' ? 'FINDING' : 'PASS', `POST /join -> ${j.status} ${j.text.slice(0, 100)}`);
  const pr = await call('POST', '/workout-logs/progress', { token: C.token, body: { challengeId: privChallenge, imageUrl: 'https://example.com/x.jpg' } });
  rec('A01-12', 'A01', 'Log progress in a challenge you are not in (BUG-04 fix)', pr.status === 403 ? 'PASS' : 'FINDING', `-> ${pr.status}`);
}
{
  const adminOnly = [
    ['GET', '/users/banned'], ['PATCH', `/users/${B.id}/ban`], ['PATCH', `/users/${B.id}/unban`],
    ['GET', '/reports/pending'], ['PATCH', '/reports/1/resolve'], ['PATCH', `/challenges/${pubChallenge}/close`],
    ['PATCH', `/challenges/${pubChallenge}/reopen`],
  ];
  for (const [m, p] of adminOnly) {
    const r = await call(m, p, { token: C.token, body: m === 'PATCH' ? { action: 'dismiss' } : undefined });
    rec('A01-ADM', 'A01', `Admin route as normal user: ${m} ${p}`, r.status === 403 ? 'PASS' : 'FINDING', `-> ${r.status}`);
  }
  const mass1 = await call('POST', '/auth/register', { body: { email: `m_${randomUUID().slice(0, 6)}@example.com`, username: `m_${randomUUID().slice(0, 6)}`, password: 'Passw0rd!x', acceptTerms: true, confirmAge16: true, is_admin: true } });
  rec('A01-13', 'A01', 'Mass assignment: register with is_admin:true', mass1.status === 400 ? 'PASS' : 'FINDING', `-> ${mass1.status}`);
  const mass2 = await call('PATCH', '/users/me/profile', { token: C.token, body: { is_admin: true, display_name: 'x' } });
  rec('A01-14', 'A01', 'Mass assignment: PATCH profile with is_admin', mass2.status === 400 ? 'PASS' : 'FINDING', `-> ${mass2.status}`);
  rec('A01-15', 'A01', 'is_admin actually unchanged', sql(`SELECT is_admin FROM havit.users WHERE id='${C.id}'`) === 'f' ? 'PASS' : 'FINDING', 'db check');
}

// ---------- A02 Cryptographic failures / A07 auth
{
  const tk = A.token;
  const [h, p] = tk.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url').toString()));
  rec('A02-01', 'A02', 'JWT algorithm / lifetime', 'INFO', `alg=${h.alg}, lifetime=${Math.round((p.exp - p.iat) / 3600)}h, claims=${Object.keys(p).join(',')}`);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...p, sub: ADM.id })}.`;
  const r1 = await call('GET', '/users/banned', { token: none });
  rec('A02-02', 'A02', 'JWT alg=none forgery', r1.status === 401 ? 'PASS' : 'FINDING', `-> ${r1.status}`);
  let cracked = null;
  for (const s of ['secret', 'changeme', 'jwt_secret', 'havit', 'your-secret-key', 'supersecret', 'password', '123456', 'JWT_SECRET', 'local-security-test']) {
    const head = b64({ alg: 'HS256', typ: 'JWT' }); const body = b64({ ...p, sub: ADM.id });
    const sig = createHmac('sha256', s).update(`${head}.${body}`).digest('base64url');
    const r = await call('GET', '/users/banned', { token: `${head}.${body}.${sig}` });
    if (r.status === 200) cracked = s;
  }
  rec('A02-03', 'A02', 'JWT signed with common weak secrets', cracked ? 'FINDING' : 'PASS', cracked ? `accepted secret ${cracked}` : 'none of 10 common secrets accepted (a short guessable production secret would still be a risk; length unknown)');
  const me = await call('GET', '/users/me', { token: tk });
  const prof = await call('GET', '/users/me/profile', { token: tk });
  const leak = /password|hash/i.test(me.text + prof.text);
  rec('A02-04', 'A02', 'Password hash exposed in /users/me or profile', leak ? 'FINDING' : 'PASS', leak ? me.text.slice(0, 200) : 'no password/hash fields');
  const other = await call('GET', `/users/${C.id}/profile`, { token: tk });
  rec('A02-05', 'A02', 'Other-user profile leaks email?', /@example\.com/.test(other.text) ? 'FINDING' : 'PASS', other.text.slice(0, 160));
  const sr = await call('GET', `/users/search?q=sec_`, { token: tk });
  rec('A02-06', 'A02', 'User search leaks email', /@example\.com/.test(sr.text) ? 'FINDING' : 'PASS', sr.text.slice(0, 160));
  const hash = sql(`SELECT password_hash FROM havit.users WHERE id='${A.id}'`);
  rec('A02-07', 'A02', 'bcrypt cost factor', 'INFO', hash.slice(0, 7) + ' (cost 10 - OWASP minimum recommended is 10-12)');
  rec('A02-08', 'A02', 'Transport', 'INFO', 'API listens on plain HTTP in this run; production URL is http://20.63.84.1:3000 (see docs). HSTS header is sent but ignored over HTTP.');
}
{
  // login behaviour
  const good = await call('POST', '/auth/login', { body: { email: A.email, password: A.password } });
  const wrongPass = await call('POST', '/auth/login', { body: { email: A.email, password: 'nope-nope-1' } });
  const noUser = await call('POST', '/auth/login', { body: { email: 'ghost@example.com', password: 'nope-nope-1' } });
  rec('A07-01', 'A07', 'Login user enumeration (message)', wrongPass.text === noUser.text.replace('ghost', '') || (wrongPass.json?.message === noUser.json?.message) ? 'PASS' : 'FINDING', `wrong pass: ${wrongPass.status} "${wrongPass.json?.message}" | no user: ${noUser.status} "${noUser.json?.message}"`);
  const times = { wrongPass: [], noUser: [] };
  await new Promise((r) => setTimeout(r, 61000)); // reset the 10/min window
  for (let i = 0; i < 4; i++) { times.wrongPass.push((await call('POST', '/auth/login', { body: { email: A.email, password: 'nope-nope-1' } })).ms); times.noUser.push((await call('POST', '/auth/login', { body: { email: `ghost${i}@example.com`, password: 'nope-nope-1' } })).ms); }
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  rec('A07-02', 'A07', 'Login timing side channel (existing vs unknown email)', Math.abs(avg(times.wrongPass) - avg(times.noUser)) > 25 ? 'FINDING' : 'PASS', `avg existing=${avg(times.wrongPass)}ms unknown=${avg(times.noUser)}ms (bcrypt only runs for existing accounts)`);
  const dup = await call('POST', '/auth/register', { body: { email: A.email, username: `x_${randomUUID().slice(0, 6)}`, password: 'Passw0rd!x', acceptTerms: true, confirmAge16: true } });
  rec('A07-03', 'A07', 'Register enumerates existing emails', dup.status === 200 ? 'PASS' : 'FINDING', `duplicate email -> ${dup.status} "${dup.json?.message}"`);
  for (const weak of ['1', 'abc', 'password', '12345678']) {
    const w = await call('POST', '/auth/register', { body: { email: `w_${randomUUID().slice(0, 6)}@example.com`, username: `w_${randomUUID().slice(0, 6)}`, password: weak, acceptTerms: true, confirmAge16: true } });
    rec('A07-04', 'A07', `Weak password accepted: "${weak}"`, w.status === 200 ? 'FINDING' : 'PASS', `-> ${w.status} ${w.json?.message ?? ''}`);
  }
  // brute force limiter
  await new Promise((r) => setTimeout(r, 61000));
  const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await call('POST', '/auth/login', { body: { email: A.email, password: `guess-${i}-xx` } })).status);
  rec('A07-05', 'A07', 'Brute force limiter on /auth/login (10/min/IP)', codes.includes(429) ? 'PASS' : 'FINDING', `statuses: ${codes.join(',')}`);
  await new Promise((r) => setTimeout(r, 61000));
  const spoof = [];
  for (let i = 0; i < 14; i++) spoof.push((await call('POST', '/auth/login', { body: { email: A.email, password: `guess-${i}-xx` }, headers: { 'X-Forwarded-For': `10.9.${i}.${i + 1}` } })).status);
  rec('A07-06', 'A07', 'Rate-limit bypass via spoofed X-Forwarded-For', spoof.includes(429) ? 'PASS' : 'FINDING', `statuses: ${spoof.join(',')} (429 present = header not trusted)`);
  const lock = await call('POST', '/auth/login', { body: { email: A.email, password: A.password } });
  rec('A07-07', 'A07', 'No account lockout after failed attempts (limiter is per IP only)', 'INFO', `valid login after 28 bad attempts from same IP -> ${lock.status} (429 means IP window; no per-account lockout/alerts)`);
  // session lifecycle
  const lo = await call('POST', '/auth/logout', { token: A.token });
  const after = await call('GET', '/users/me', { token: A.token });
  rec('A07-08', 'A07', 'Token still valid after logout (stateless JWT, no revocation)', after.status === 200 ? 'FINDING' : 'PASS', `logout -> ${lo.status}; /users/me after logout -> ${after.status}`);
}

// ---------- A03 Injection
{
  const probes = ["' OR '1'='1", "'; SELECT pg_sleep(4);--", '1; DROP TABLE havit.users;--', '%', '_', '\\', "\" OR 1=1 --", '${7*7}', '{{7*7}}'];
  for (const q of probes) {
    const t0 = Date.now();
    const r = await call('GET', `/users/search?q=${encodeURIComponent(q)}`, { token: C.token });
    const ms = Date.now() - t0;
    const slow = ms > 3500;
    rec('A03-01', 'A03', `SQLi probe on /users/search q=${q.slice(0, 30)}`, slow || r.status >= 500 ? 'FINDING' : 'PASS', `-> ${r.status} in ${ms}ms, rows=${Array.isArray(r.json) ? r.json.length : 'n/a'}`);
  }
  const wild = await call('GET', `/users/search?q=%25`, { token: C.token });
  rec('A03-02', 'A03', 'LIKE wildcard not escaped in user search ("%" lists everyone)', Array.isArray(wild.json) && wild.json.length > 1 ? 'FINDING' : 'PASS', `q=% -> ${wild.status}, ${Array.isArray(wild.json) ? wild.json.length : '?'} users returned`);
  const ids = ["1 OR 1=1", "1;select pg_sleep(4)", "' or ''='", '../../etc/passwd', '%00'];
  for (const id of ids) {
    const r = await call('GET', `/exercises/${encodeURIComponent(id)}/full`, {});
    const r2 = await call('GET', `/workout-posts/user/${encodeURIComponent(id)}`, { token: C.token });
    rec('A03-03', 'A03', `Malformed id "${id}" in path`, r.status < 500 && r2.status < 500 ? 'PASS' : 'FINDING', `exercises/:id -> ${r.status}, posts/user/:id -> ${r2.status}`);
  }
  const cursor = await call('GET', `/workout-posts/user/${C.id}?cursor=${encodeURIComponent("'; select pg_sleep(4);--")}`, { token: C.token });
  rec('A03-04', 'A03', 'SQLi probe on cursor param', cursor.status === 400 ? 'PASS' : 'INFO', `-> ${cursor.status}`);
  const lim = await call('GET', `/workout-posts/user/${C.id}?limit=999999999`, { token: C.token });
  rec('A03-05', 'A03', 'Pagination limit cap', lim.status === 400 || lim.status === 200 ? 'PASS' : 'FINDING', `limit=999999999 -> ${lim.status}`);
  const xss = await call('GET', `/workout-posts/user/${B.id}`, { token: B.token });
  rec('A03-06', 'A03', 'Stored XSS payload returned verbatim (JSON API; escaping is the client job)', xss.text.includes('<script>') ? 'INFO' : 'PASS', 'caption "<script>" stored/returned raw; RN renders as text (no HTML), a future web client must escape');
  const nosql = await call('POST', '/auth/login', { body: { email: { $ne: '' }, password: { $ne: '' } } });
  rec('A03-07', 'A03', 'Operator injection in login body', nosql.status === 400 ? 'PASS' : 'FINDING', `-> ${nosql.status}`);
}

// ---------- A04/A05/A08/A10
{
  const big = JSON.stringify({ content: 'x'.repeat(2_000_000) });
  const r = await call('POST', '/auth/login', { raw: big, headers: { 'Content-Type': 'application/json' } });
  rec('A04-01', 'A04', 'Oversized JSON body (2 MB) rejected', r.status === 413 ? 'PASS' : 'INFO', `-> ${r.status}`);
  const long = await call('POST', `/workout-posts/${bPostId}/comments`, { token: B.token, body: { comment_text: 'y'.repeat(100000) } });
  rec('A04-02', 'A04', 'Very long comment (100k chars)', long.status === 400 ? 'PASS' : 'FINDING', `-> ${long.status}`);
  const neg = await call('POST', '/workout-logs/progress', { token: B.token, body: { challengeId: pubChallenge, imageUrl: 'https://example.com/n.jpg', routineId: -5 } });
  rec('A04-03', 'A04', 'Negative routineId handled', neg.status < 500 ? 'PASS' : 'FINDING', `-> ${neg.status}`);
  const ssrf = ['http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://evil.example/x', 'http://localhost:5432/'];
  for (const u of ssrf) {
    const ch = randomUUID();
    sql(`INSERT INTO havit.challenges (id,name,visibility,created_by_user_id,duration_days) VALUES ('${ch}','ssrf','public','${C.id}',30)`);
    sql(`INSERT INTO havit.challenge_user_map (challenge_id,user_id,role,status) VALUES ('${ch}','${C.id}','owner','active')`);
    const r2 = await call('POST', '/workout-logs/progress', { token: C.token, body: { challengeId: ch, imageUrl: u } });
    rec('A10-01', 'A10', `Progress imageUrl accepts arbitrary scheme/host: ${u.slice(0, 40)}`, r2.status === 201 ? 'FINDING' : 'PASS', `-> ${r2.status}`);
  }
  const photo = await call('PATCH', '/users/me/profile/photo', { token: C.token, body: { profile_image_url: 'javascript:alert(1)' } });
  rec('A10-02', 'A10', 'Profile photo URL accepts arbitrary scheme', photo.status === 200 ? 'FINDING' : 'PASS', `-> ${photo.status}`);
  const up = await call('POST', '/uploads/sign', { token: C.token, body: { fileType: 'text/html' } });
  rec('A08-01', 'A08', 'Upload sign only allows image mime types', up.status === 400 ? 'PASS' : 'INFO', `text/html -> ${up.status} ${up.text.slice(0, 80)}`);
}
{
  const cors = await call('GET', '/', { headers: { Origin: 'https://evil.example' } });
  rec('A05-01', 'A05', 'CORS reflects any origin', cors.headers.get('access-control-allow-origin') === 'https://evil.example' ? 'FINDING' : 'PASS', `ACAO=${cors.headers.get('access-control-allow-origin')} creds=${cors.headers.get('access-control-allow-credentials')} (CORS_ORIGINS not set => reflect all; tokens are Bearer so impact is low, but open)`);
  const sw = await call('GET', '/api-docs');
  rec('A05-02', 'A05', 'Swagger UI exposed (no auth, no env gate)', sw.status === 200 ? 'FINDING' : 'PASS', `/api-docs -> ${sw.status}`);
  const bad = await call('POST', '/auth/login', { raw: '{"email":', headers: { 'Content-Type': 'application/json' } });
  rec('A05-03', 'A05', 'Malformed JSON error does not leak stack', /at .*\.js|node_modules/.test(bad.text) ? 'FINDING' : 'PASS', bad.text.slice(0, 140));
  const e500 = await call('GET', '/workout-posts/not-a-uuid/comments', { token: C.token });
  rec('A05-04', 'A05', 'Invalid id error shape', /node_modules|\.ts:/.test(e500.text) ? 'FINDING' : 'PASS', `${e500.status} ${e500.text.slice(0, 120)}`);
  const h = (await call('GET', '/')).headers;
  rec('A05-05', 'A05', 'X-Powered-By / Server banner', h.get('x-powered-by') ? 'FINDING' : 'PASS', `x-powered-by=${h.get('x-powered-by')}`);
  const tr = await call('TRACE', '/');
  rec('A05-06', 'A05', 'TRACE method', tr.status === 200 ? 'FINDING' : 'PASS', `-> ${tr.status}`);
  const seed = sql(`SELECT count(*) FROM havit.users WHERE username='testuser'`);
  rec('A05-07', 'A05', "Seeded default account 'testuser' (password in repo) created by db:migrate on every environment", seed === '1' ? 'FINDING' : 'PASS', `testuser rows: ${seed}; password TestHavit123! is in database/seeds/2026-07-21-01-test-user.sql`);
  const lg = await call('POST', '/auth/login', { body: { email: 'testuser@havit.dev', password: 'TestHavit123!' } });
  rec('A07-09', 'A07', 'Login with the seeded default credentials', lg.status === 200 ? 'FINDING' : 'PASS', `-> ${lg.status}`);
}
writeFileSync(process.argv[2] ?? 'sec-results.json', JSON.stringify(results, null, 2));
console.log('DONE', results.length);
