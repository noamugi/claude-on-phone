// End-to-end test against `wrangler dev` (run it first on :8787 with .dev.vars).
// Acts as a fake push service: receives the push, checks the VAPID signature,
// and decrypts the payload the way a phone would.
import http from 'node:http';
import crypto from 'node:crypto';
import ece from 'http_ece';

const SERVER = process.env.SERVER || 'http://localhost:8787';
const b64u = (b) => Buffer.from(b).toString('base64url');
let fails = 0;
const ok = (cond, msg) => { console.log(cond ? '  ✓' : '  ✗', msg); if (!cond) fails++; };

const pushes = [];
const recv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { pushes.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
}).listen(9999);

const client = crypto.createECDH('prime256v1');
client.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: 'http://localhost:9999/push/abc', keys: { p256dh: b64u(client.getPublicKey()), auth: b64u(auth) } };
const id = crypto.randomUUID();
const post = (path, body) => fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const waitFor = async (n, ms) => { const end = Date.now() + ms; while (pushes.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); return pushes.length >= n; };
const decode = (p) => JSON.parse(ece.decrypt(p.body, { version: 'aes128gcm', privateKey: client, authSecret: auth }).toString());

const { publicKey } = await fetch(SERVER + '/vapid').then((r) => r.json());
ok(Buffer.from(publicKey, 'base64url').length === 65, 'VAPID public key is a P-256 point');
ok((await fetch(SERVER + '/vapid').then((r) => r.json())).publicKey === publicKey, 'VAPID key is stable');

const bad = await post('/sync', { id, subscription: { ...sub, endpoint: 'https://example.com/x' } });
ok(bad.status === 400, 'rejects endpoints that are not push services');

const now = Date.now();
const r = await post('/sync', { id, subscription: sub, due: { water: now - 1000, walk: now + 3600e3 }, quietUntil: 0, start: '00:00', end: '23:59', tz: 'UTC' });
ok(r.status === 200 && r.json.push === true, 'sync accepted');
ok(await waitFor(1, 6000), 'overdue water reminder pushed');
if (pushes[0]) {
  const p = pushes[0];
  const msg = decode(p);
  ok(/water|drink|sip/i.test(msg.title + msg.body), `payload decrypts: "${msg.title}" / "${msg.body}"`);
  const [, jwt, k] = p.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/) || [];
  ok(k === publicKey, 'Authorization carries our public key');
  const [h, c, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  ok(claims.aud === 'http://localhost:9999' && claims.sub.startsWith('https://'), `JWT claims aud/sub: ${claims.aud} ${claims.sub}`);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(publicKey, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(publicKey, 'base64url').subarray(33)) }, format: 'jwk' });
  ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'JWT signature verifies');
  ok(p.headers.urgency === 'high' && p.headers.topic === 'nag' && p.headers['content-encoding'] === 'aes128gcm', 'aes128gcm + urgency + topic headers');
}

const t = await post('/test', { id });
ok(t.status === 200 && t.json.ok, '/test responds ok');
ok(await waitFor(2, 3000) && /on/i.test(decode(pushes[1]).title), 'test notification arrives');

// Quiet mode: nothing while quiet, even though water is overdue.
const before = pushes.length;
await post('/sync', { id, due: { water: Date.now() - 500, walk: Date.now() + 3600e3 }, quietUntil: Date.now() + 60e3 });
await new Promise((r) => setTimeout(r, 3000));
ok(pushes.length === before, 'quiet mode holds pushes');

// Goal met / done: nothing due soon means no push.
await post('/sync', { id, due: { water: Date.now() + 3600e3, walk: Date.now() + 3600e3 }, quietUntil: 0 });
await new Promise((r) => setTimeout(r, 3000));
ok(pushes.length === before, 'no push when nothing is due');

recv.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
