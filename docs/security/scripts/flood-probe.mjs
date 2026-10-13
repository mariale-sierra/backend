// SOLO PARA ENTORNO LOCAL AISLADO. Nunca apuntar a Azure/producción: crea usuarios, edita la BD por psql y genera carga.
// Requiere: backend compilado corriendo en localhost (3100 limites por defecto / 3101 con THROTTLE_LIMIT alto) y un Postgres desechable en 55440.
// Las rutas absolutas de psql/autocannon son las del equipo donde se ejecuto; ajustalas.
// Flood / load probes against the LOCAL isolated instances only (3100 = default limits, 3101 = limiter effectively off).
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const AC = 'C:/Users/males/OneDrive/Documentos/Havit/backend/node_modules/autocannon/autocannon.js';
const out = [];
async function token(port, tag) {
  const username = `fl_${tag}_${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`http://localhost:${port}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${username}@example.com`, username, password: 'Passw0rd!x', acceptTerms: true, confirmAge16: true }) });
  return (await r.json()).accessToken;
}
function run(name, port, path, { method = 'GET', conns = 50, secs = 10, headers = {}, body } = {}) {
  const args = [AC, '-j', '-c', String(conns), '-d', String(secs), '-m', method];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}=${v}`);
  if (body) args.push('-b', body);
  args.push(`http://localhost:${port}${path}`);
  const raw = execFileSync('node', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const j = JSON.parse(raw);
  const codes = { '2xx': j['2xx'], '4xx': j['4xx'], '5xx': j['5xx'], non2xx: j.non2xx, errors: j.errors, timeouts: j.timeouts };
  const row = { name, port, path, method, conns, secs, rps: Math.round(j.requests.average), total: j.requests.total, lat_avg_ms: j.latency.average, lat_p99_ms: j.latency.p99, lat_max_ms: j.latency.max, ...codes };
  console.log(JSON.stringify(row));
  out.push(row);
  return row;
}
const probe = async (port) => { const t = Date.now(); try { const r = await fetch(`http://localhost:${port}/`); return `${r.status} in ${Date.now() - t}ms`; } catch (e) { return 'FAILED ' + e.message; } };

// ---- default limits (what production runs): the limiter is the first line of defence
const t1 = await token(3100, 'a');
run('F1 unauth GET / (default limits)', 3100, '/', { conns: 100 });
console.log('health right after F1:', await probe(3100));
await new Promise((r) => setTimeout(r, 62000));
run('F2 bad-password login flood (default limits)', 3100, '/auth/login', { method: 'POST', conns: 50, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'testuser@havit.dev', password: 'wrong-password-1' }) });
console.log('health right after F2:', await probe(3100));
await new Promise((r) => setTimeout(r, 62000));
run('F3 authed GET /feed (default limits)', 3100, '/feed', { conns: 100, headers: { authorization: `Bearer ${t1}` } });

// ---- limiter effectively disabled (distributed attacker / many IPs behind one NAT): raw capacity
const t2 = await token(3101, 'b');
const auth = { authorization: `Bearer ${t2}` };
run('F4 authed GET /feed (no limiter)', 3101, '/feed', { conns: 100, secs: 15, headers: auth });
console.log('health right after F4:', await probe(3101));
run('F5 authed GET /workout-posts/mine (no limiter)', 3101, '/workout-posts/mine', { conns: 100, secs: 10, headers: auth });
run('F6 public GET /challenges (no limiter)', 3101, '/challenges', { conns: 100, secs: 10 });
run('F7 GET /users/search?q=% (no limiter)', 3101, '/users/search?q=%25', { conns: 100, secs: 10, headers: auth });
run('F8 POST /auth/register (bcrypt cost) (no limiter)', 3101, '/auth/register', {
  method: 'POST', conns: 30, secs: 10, headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'flood@example.com', username: 'flood', password: 'Passw0rd!x', acceptTerms: true, confirmAge16: true }),
});
console.log('health right after F8:', await probe(3101));
// request with a huge invalid body, many times
run('F9 large-body POST (2 MB) (no limiter)', 3101, '/auth/login', { method: 'POST', conns: 20, secs: 8, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2_000_000) }) });
console.log('health after all:', await probe(3101));
writeFileSync('flood-results.json', JSON.stringify(out, null, 2));
