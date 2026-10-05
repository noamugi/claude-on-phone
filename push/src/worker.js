// Nag push server: remembers when your reminders are due and keeps sending
// iPhone/Android push notifications until the app says you did the thing.
//
// One Durable Object per phone (keyed by a random id the app makes up), plus
// one that holds the server's VAPID keys. Alarms do the scheduling.

import { DurableObject } from 'cloudflare:workers';
import { buildPush, generateVapidKeys } from './webpush.js';

const MIN = 60 * 1000;
const KINDS = ['water', 'walk'];
const KEYS_ID = '__vapid_keys__';
const CONTACT = 'https://noamugi.github.io/claude-on-phone/';
// Only real push services, so this can't be used to make requests elsewhere.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const LINES = {
  water: [
    ['Babe. Your bottle is right there. 💧', 'Hydrated girls glow. Go drink. ✨', 'A few big sips, bestie.'],
    ['Still nothing? Your skin is crying. 😭', 'You are basically a raisin right now, babe.', 'I can keep this up all day. Can you?'],
    ['I WILL KEEP BUZZING UNTIL YOU DRINK.', 'THE BOTTLE. PICK IT UP. NOW.', 'Ignoring me won\'t make me stop. 💢'],
  ],
  walk: [
    ['Hot girl walk time. 🎀', 'Stand up, queen. Go walk.', 'Your legs called. They miss you. 💌'],
    ['Still sitting? Not cute.', 'Your spine is filing a complaint, babe.', 'Even your houseplant moves more than you. 🪴'],
    ['I AM NOT ASKING ANYMORE.', 'WALK OR LISTEN TO THIS FOREVER.', 'GET. UP. 💢'],
  ],
};
const TITLES = {
  water: ['Sip sip, babe 💧', 'DRINK. WATER. 💧', 'DRINK. WATER. NOW. 💢'],
  walk: ['Walkies, babe 👟', 'GO. WALK. 👟', 'GET UP AND WALK. 💢'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });


// Gap between pushes once something is overdue. It gets more insistent.
function gapFor(overdueMs) {
  if (overdueMs < 10 * MIN) return 5 * MIN;
  if (overdueMs < 30 * MIN) return 3 * MIN;
  return 2 * MIN;
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}
function localMinutes(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}
function isAwake(s, now) {
  const a = minutesOf(s.start);
  const b = minutesOf(s.end);
  const m = localMinutes(s.tz, now);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

function validSubscription(sub, env) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return false;
  if (typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return false;
  let u;
  try { u = new URL(sub.endpoint); } catch { return false; }
  // Local tests only (set in .dev.vars, never in production).
  if (env.ALLOW_LOCAL_ENDPOINTS === '1' && u.hostname === 'localhost') return true;
  return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
const validTime = (t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
const validMs = (v) => v === null || (Number.isFinite(v) && v > 0);

export class Nagger extends DurableObject {
  // --- VAPID keys (only used on the KEYS_ID instance) ---
  async keys() {
    let k = await this.ctx.storage.get('vapid');
    if (!k) {
      k = await generateVapidKeys();
      await this.ctx.storage.put('vapid', k);
    }
    return k;
  }

  // --- One phone's schedule ---
  async sync(data) {
    const s = (await this.ctx.storage.get('state')) || { due: {}, lastSent: {}, count: {}, resting: false };
    if (data.subscription) {
      if (!validSubscription(data.subscription, this.env)) return { error: 'bad subscription' };
      s.sub = { endpoint: data.subscription.endpoint, keys: data.subscription.keys };
    }
    for (const k of KINDS) {
      const v = data.due ? data.due[k] : undefined;
      if (v === undefined) continue;
      if (!validMs(v)) return { error: 'bad due time' };
      // A new due time means a new reminder: start the nagging over.
      if (Math.abs((s.due[k] || 0) - (v || 0)) > 1000) { s.lastSent[k] = 0; s.count[k] = 0; }
      s.due[k] = v;
    }
    if (data.quietUntil !== undefined) {
      if (!(data.quietUntil === 0 || validMs(data.quietUntil))) return { error: 'bad quiet time' };
      s.quietUntil = data.quietUntil;
    }
    if (data.start !== undefined || data.end !== undefined || data.tz !== undefined) {
      if (!validTime(data.start) || !validTime(data.end) || !validTz(data.tz)) return { error: 'bad schedule' };
      s.start = data.start; s.end = data.end; s.tz = data.tz;
    }
    await this.ctx.storage.put('state', s);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    return { ok: true, push: !!s.sub };
  }

  async test() {
    const s = await this.ctx.storage.get('state');
    if (!s || !s.sub) return { error: 'no subscription' };
    const status = await this.send(s, { title: 'Notifications are on 💕', body: 'Now I can find you even when I\'m closed. Good luck, babe.', tag: 'nag-test' });
    await this.ctx.storage.put('state', s);
    return { ok: status >= 200 && status < 300, status };
  }

  async alarm() {
    const s = await this.ctx.storage.get('state');
    if (!s || !s.sub || !s.tz) return;
    const now = Date.now();
    const save = () => this.ctx.storage.put('state', s);

    if (s.quietUntil && s.quietUntil > now) {
      s.resting = true;
      await save();
      return this.ctx.storage.setAlarm(s.quietUntil + 1000);
    }
    if (!isAwake(s, now)) {
      s.resting = true;
      await save();
      return this.ctx.storage.setAlarm(now + 10 * MIN);
    }
    if (s.resting) {
      // Whatever came due while you slept or sat in a meeting starts now.
      s.resting = false;
      for (const k of KINDS) if (s.due[k] && s.due[k] < now) { s.due[k] = now; s.lastSent[k] = 0; s.count[k] = 0; }
    }

    const due = KINDS.filter((k) => s.due[k] && s.due[k] <= now).sort((a, b) => s.due[a] - s.due[b]);
    if (!due.length) {
      await save();
      const next = Math.min(...KINDS.map((k) => s.due[k] || Infinity));
      if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
      return;
    }

    const kind = due[0];
    const overdue = now - s.due[kind];
    const gap = gapFor(overdue);
    if (now - (s.lastSent[kind] || 0) >= gap - 5000) {
      const level = overdue < 2 * MIN ? 0 : overdue < 10 * MIN ? 1 : 2;
      const mins = Math.floor(overdue / MIN);
      const body = pick(LINES[kind][level]) + (mins >= 1 ? ` (${mins} min overdue)` : '');
      await this.send(s, { title: TITLES[kind][level], body, tag: 'nag' });
      s.lastSent[kind] = now;
      s.count[kind] = (s.count[kind] || 0) + 1;
    }
    await save();
    if (s.sub) await this.ctx.storage.setAlarm(now + gap);
  }

  async send(s, payload) {
    try {
      const vapid = await this.env.NAGGER.get(this.env.NAGGER.idFromName(KEYS_ID)).keys();
      const { endpoint, init } = await buildPush({
        subscription: s.sub,
        payload: { ...payload, url: './' },
        vapid,
        subject: CONTACT,
        topic: 'nag',
      });
      const res = await fetch(endpoint, init);
      // The phone unsubscribed or the app was deleted: stop trying.
      if (res.status === 404 || res.status === 410) s.sub = null;
      if (res.status >= 300) console.log('push failed', res.status, await res.text().catch(() => ''));
      return res.status;
    } catch (err) {
      // A failed send must never stop the reminder loop.
      console.log('push error', String(err));
      return 0;
    }
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    if (url.pathname === '/vapid') {
      const k = await env.NAGGER.get(env.NAGGER.idFromName(KEYS_ID)).keys();
      return json({ publicKey: k.publicKey });
    }

    if (req.method === 'POST' && (url.pathname === '/sync' || url.pathname === '/test')) {
      let data;
      try { data = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!data || typeof data.id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(data.id) || data.id === KEYS_ID) {
        return json({ error: 'bad id' }, 400);
      }
      const stub = env.NAGGER.get(env.NAGGER.idFromName(data.id));
      const out = url.pathname === '/sync' ? await stub.sync(data) : await stub.test();
      return json(out, out.error ? 400 : 200);
    }

    if (url.pathname === '/') return json({ ok: true, app: 'nag-push' });
    return json({ error: 'not found' }, 404);
  },
};
