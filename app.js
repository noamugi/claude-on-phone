'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const KEY = 'nag-state-v2';
const MIN = 60 * 1000;
const SNOOZE_MS = 5 * MIN;
const CHECK_WINDOW = 15 * 1000;
const MIN_VIDEO_S = 5;
const STEPS_PER_MIN = 100; // a brisk walk
const KINDS = ['water', 'walk'];

const DEFAULTS = {
  settings: {
    waterGoal: 2000, bottle: 750, water: 45,
    stepGoal: 10000, walk: 60,
    start: '08:00', end: '22:00', snoozes: 2,
  },
  next: { water: 0, walk: 0 },
  // Snoozes are counted per reminder so you can't snooze forever.
  snoozed: { water: 0, walk: 0 },
  // {kind, since, voluntary, walkMin}
  active: null,
  // {until, why: 'meeting' | 'sleep'}
  quiet: null,
  wasResting: false,
  day: null,
  streak: { count: 0, lastDay: null },
};

let S = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw) return { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...raw.settings } };
  } catch {}
  return structuredClone(DEFAULTS);
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
}

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayBefore = (key) => {
  const d = new Date(key + 'T12:00');
  d.setDate(d.getDate() - 1);
  return todayKey(d);
};
const goalMet = (d) => d.waterMl >= S.settings.waterGoal && d.steps >= S.settings.stepGoal;
const newDay = () => ({ date: todayKey(), waterMl: 0, drinks: 0, walks: 0, steps: 0, ignoredMs: 0, snoozes: 0 });

function rollDay() {
  if (S.day && S.day.date === todayKey()) return;
  if (S.day) {
    if (goalMet(S.day)) {
      S.streak.count = S.streak.lastDay === dayBefore(S.day.date) ? S.streak.count + 1 : 1;
      S.streak.lastDay = S.day.date;
    } else {
      S.streak.count = 0;
    }
  }
  S.day = newDay();
  // New day, new goals: anything parked until "tomorrow" gets a fresh schedule.
  for (const k of KINDS) if (!S.active || S.active.kind !== k) schedule(k);
  save();
}

// ---------------------------------------------------------------------------
// Schedule + pace
// ---------------------------------------------------------------------------

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
// Awake window in minutes since midnight; `end` may run past midnight.
function awakeWindow() {
  const a = minutesOf(S.settings.start);
  const b = minutesOf(S.settings.end);
  return [a, b > a ? b : b + 1440];
}
function minuteInWindow(t = new Date()) {
  const [a, b] = awakeWindow();
  let m = t.getHours() * 60 + t.getMinutes();
  if (m < a && m + 1440 < b) m += 1440;
  return m;
}
function isAwake(t = new Date()) {
  const [a, b] = awakeWindow();
  const m = minuteInWindow(t);
  return m >= a && m < b;
}
function nextAwakeStart(t = new Date()) {
  const d = new Date(t);
  const a = minutesOf(S.settings.start);
  d.setHours(Math.floor(a / 60), a % 60, 0, 0);
  if (d <= t) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function dayProgress(t = new Date()) {
  const [a, b] = awakeWindow();
  return Math.min(1, Math.max(0, (minuteInWindow(t) - a) / (b - a)));
}
function awakeMinutesLeft(t = new Date()) {
  const [, b] = awakeWindow();
  return isAwake(t) ? b - minuteInWindow(t) : 0;
}

function pace(kind) {
  const goal = kind === 'water' ? S.settings.waterGoal : S.settings.stepGoal;
  const have = kind === 'water' ? S.day.waterMl : S.day.steps;
  const behind = goal * dayProgress() - have;
  return { goal, have, behind, left: goal - have };
}

// Behind pace? You hear from me more often. Goal met? I leave you alone today.
function intervalFor(kind) {
  const p = pace(kind);
  if (p.left <= 0) return null;
  const base = S.settings[kind];
  return p.behind > p.goal * 0.15 ? Math.max(10, Math.round(base * 0.6)) : base;
}

function schedule(kind, from = Date.now()) {
  const iv = intervalFor(kind);
  if (iv == null) { S.next[kind] = nextAwakeStart(new Date(from)) + 5 * MIN; return; }
  let at = from + iv * MIN;
  if (!isAwake(new Date(at))) at = nextAwakeStart(new Date(at)) + 5 * MIN;
  S.next[kind] = at;
}

// Long enough to close the step gap across the walks left today.
function walkMinutes() {
  const p = pace('walk');
  if (p.left <= 0) return 10;
  const walksLeft = Math.max(1, Math.floor(awakeMinutesLeft() / S.settings.walk));
  return Math.min(30, Math.max(10, Math.ceil(p.left / walksLeft / STEPS_PER_MIN)));
}

// ---------------------------------------------------------------------------
// Messages. They get worse.
// ---------------------------------------------------------------------------

const LINES = {
  water: [
    ['Babe. Your bottle is right there. 💧', 'Hydrated girls glow. Go drink. ✨', 'A few big sips, bestie. That is all I ask.'],
    ['Still nothing? Your skin is crying. 😭', 'You are basically a raisin right now, babe.', 'I can keep this up all day. Can you?'],
    ['DRINK. YOUR. WATER. 💢', 'I WILL SCREAM UNTIL YOU DRINK.', 'THE BOTTLE. PICK IT UP. NOW.'],
  ],
  walk: [
    ['Hot girl walk time. 🎀', 'Stand up, queen. Go walk.', 'Your legs called. They miss you. 💌'],
    ['Still sitting? Not cute.', 'Your spine is filing a complaint, babe.', 'Even your houseplant moves more than you. 🪴'],
    ['GET. UP. 💢', 'I AM NOT ASKING ANYMORE.', 'WALK OR LISTEN TO THIS FOREVER.'],
  ],
};
const TITLES = {
  water: ['Sip sip, babe.', 'DRINK. WATER.', 'DRINK. WATER. NOW.'],
  walk: ['Walkies, babe.', 'GO. WALK.', 'GET UP AND WALK.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const num = (n) => Math.round(n).toLocaleString('en-US');
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function paceText(kind) {
  const p = pace(kind);
  const unit = kind === 'water' ? 'ml' : 'steps';
  if (p.left <= 0) return 'Goal met 🎉';
  if (p.behind > 0) return `${num(p.behind)} ${unit} behind 😬`;
  return 'On pace ✨';
}

function moodLine() {
  const ignored = Math.round(S.day.ignoredMs / MIN);
  if (S.quiet) return S.quiet.why === 'sleep' ? 'Sweet dreams. I\'ll be here. 🌙' : 'Shh. I\'m being quiet. For now. 🤫';
  if (!isAwake()) return 'Off duty. Rest up, I\'ll be back. 🌙';
  if (goalMet(S.day)) return 'Both goals met. Iconic. 👑';
  if (ignored > 30) return `You ignored me for ${ignored} minutes today. I remember.`;
  if (S.day.snoozes > 3) return 'Lots of snoozing today. Interesting choice.';
  return 'I\'m watching you, babe. 💕';
}

// ---------------------------------------------------------------------------
// Sound + vibration
// ---------------------------------------------------------------------------

let audio = null;
function unlockAudio() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (audio && audio.state === 'suspended') audio.resume();
}
function tone(freq, start, dur, vol, type = 'square', sweepTo) {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, audio.currentTime + start);
  if (sweepTo) o.frequency.linearRampToValueAtTime(sweepTo, audio.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, audio.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, audio.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
  o.connect(g).connect(audio.destination);
  o.start(audio.currentTime + start);
  o.stop(audio.currentTime + start + dur + 0.05);
}
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}
function alarm(level) {
  if (level === 1) { tone(880, 0, 0.15, 0.25); tone(880, 0.25, 0.15, 0.25); }
  else if (level === 2) { for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 990, i * 0.18, 0.14, 0.45); }
  else { tone(600, 0, 0.45, 0.7, 'sawtooth', 1400); tone(1400, 0.45, 0.45, 0.7, 'sawtooth', 600); }
  buzz(level === 3 ? [400, 100, 400, 100, 400] : level === 2 ? [250, 100, 250] : [200]);
}
function chime() {
  tone(660, 0, 0.15, 0.25, 'sine'); tone(880, 0.12, 0.15, 0.25, 'sine'); tone(1320, 0.24, 0.3, 0.25, 'sine');
}

// ---------------------------------------------------------------------------
// Notifications + keeping the screen on (where the browser allows them)
// ---------------------------------------------------------------------------

let swReg = null;
try {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
} catch {}

async function notify(kind, body) {
  // With push on, the server does the notifying; don't double up.
  if (S.pushOn || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = {
    body, tag: 'nag-' + kind, renotify: true, requireInteraction: true,
    icon: 'icon.svg', badge: 'icon.svg', vibrate: [300, 100, 300, 100, 300],
  };
  try {
    if (swReg) await swReg.showNotification(TITLES[kind][2], opts);
    else new Notification(TITLES[kind][2], opts);
  } catch {}
}

async function requestWakeLock() {
  try { await navigator.wakeLock.request('screen'); } catch {}
}

// ---------------------------------------------------------------------------
// Push: a small server sends the reminders while the app is closed. The app
// tells it when things are due, and about quiet mode and sleep hours.
// ---------------------------------------------------------------------------

let pushServer = null;
let vapidKey = null;
let lastSync = '';
let syncTimer = 0;
let syncRetryAt = 0;

const pushSupported = () => 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window;

function syncBody() {
  return {
    id: S.pushId,
    due: { water: S.next.water || null, walk: S.next.walk || null },
    quietUntil: S.quiet ? S.quiet.until : 0,
    start: S.settings.start,
    end: S.settings.end,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

async function pushPost(path, body) {
  const r = await fetch(pushServer + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'server said ' + r.status);
  return j;
}

async function syncPush() {
  if (!S.pushOn || !pushServer) return;
  const body = syncBody();
  const sig = JSON.stringify(body);
  try {
    await pushPost('/sync', body);
    lastSync = sig;
  } catch {
    syncRetryAt = Date.now() + 60 * 1000; // offline? try again in a minute
  }
}

// Called every tick: tell the server whenever the schedule changed.
function maybeSync() {
  if (!S.pushOn || !pushServer || syncTimer || Date.now() < syncRetryAt) return;
  if (JSON.stringify(syncBody()) === lastSync) return;
  // Short wait so a burst of changes goes out as one update.
  syncTimer = setTimeout(() => { syncTimer = 0; syncPush(); }, 1500);
}

function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function initPush() {
  try {
    const cfg = await fetch('push-config.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    if (cfg && cfg.server) {
      pushServer = cfg.server.replace(/\/$/, '');
      vapidKey = (await fetch(pushServer + '/vapid').then((r) => r.json())).publicKey;
    }
  } catch { pushServer = null; }
  // Permission revoked or app reinstalled: show the button again.
  if (S.pushOn && pushSupported()) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!(await reg.pushManager.getSubscription()) || Notification.permission !== 'granted') S.pushOn = false;
    } catch {}
  }
  renderPush();
}

async function enablePush() {
  unlockAudio();
  if (!pushSupported()) {
    toast('Add me to your Home Screen first (Share → Add to Home Screen), then open me from there.', 6000);
    return;
  }
  if (!pushServer || !vapidKey) { toast('Can\'t reach the notification server right now. Try again in a bit.'); return; }
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') {
      toast('Notifications are blocked. Turn them on in Settings → Notifications → Nag.', 6000);
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    if (!S.pushId) S.pushId = crypto.randomUUID();
    await pushPost('/sync', { ...syncBody(), subscription: sub.toJSON() });
    lastSync = JSON.stringify(syncBody());
    S.pushOn = true;
    save();
    renderPush();
    await pushPost('/test', { id: S.pushId });
    toast('Notifications on 💕 I\'ll find you even when I\'m closed.', 4000);
  } catch (e) {
    toast('Couldn\'t turn on notifications: ' + (e && e.message ? e.message : e), 6000);
  }
}

function renderPush() {
  const card = $('pushCard');
  card.hidden = !pushServer || !!S.pushOn;
  $('pushStatus').textContent = !pushServer
    ? 'Only in the Home Screen app.'
    : S.pushOn ? 'On ✓ I\'ll buzz you even when I\'m closed.' : 'Off';
  $('pushTest').hidden = !S.pushOn;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const nagEl = $('nag');
let lastAlarm = 0;
let lastNotify = 0;
let lastTick = Date.now();

function fmt(ms) {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}
function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

function levelFor(overdueMs) {
  if (overdueMs < 2 * MIN) return 1;
  if (overdueMs < 5 * MIN) return 2;
  return 3;
}

function tick() {
  rollDay();
  const now = Date.now();
  const dt = Math.min(now - lastTick, 10 * MIN); // count time away too, capped per tick
  lastTick = now;

  if (S.quiet && now >= S.quiet.until) {
    toast(S.quiet.why === 'sleep' ? 'Good morning, babe ☀️ Let\'s go.' : 'Quiet time is over. I\'m baaack. 💕');
    S.quiet = null;
  }

  const resting = !!S.quiet || !isAwake();
  if (resting) {
    if (S.active && !S.active.voluntary) closeNag();
    S.wasResting = true;
  } else {
    if (S.wasResting) {
      // Whatever came due while you were resting starts now, not hours ago.
      S.wasResting = false;
      for (const k of KINDS) if (S.next[k] < now) S.next[k] = now;
    }
    if (!S.active) {
      const due = KINDS.filter((k) => S.next[k] <= now).sort((a, b) => S.next[a] - S.next[b]);
      if (due.length) startNag(due[0], S.next[due[0]]);
    }
  }

  if (S.active && !S.active.voluntary) {
    S.day.ignoredMs += dt;
    const overdue = now - S.active.since;
    const level = levelFor(overdue);
    const every = level === 1 ? 6000 : level === 2 ? 3500 : 1800;
    if (now - lastAlarm > every && !proofInProgress()) { alarm(level); lastAlarm = now; }
    const nEvery = level === 1 ? 60000 : level === 2 ? 30000 : 15000;
    if (document.hidden && now - lastNotify > nEvery) {
      notify(S.active.kind, `${pick(LINES[S.active.kind][level - 1])} (${Math.round(overdue / MIN)} min overdue)`);
      lastNotify = now;
    }
    renderNag(level, overdue);
    document.title = Math.floor(now / 700) % 2 ? `⚠️ ${TITLES[S.active.kind][level - 1]}` : `(${Math.round(overdue / MIN)}m) Nag`;
  } else {
    document.title = 'Nag';
  }

  renderHome(now);
  maybeSync();
  save();
}

function renderHome(now) {
  for (const k of KINDS) {
    const p = pace(k);
    $(k + 'Have').textContent = num(p.have);
    $(k + 'GoalTxt').textContent = num(p.goal);
    $(k + 'Bar').style.width = Math.min(100, (p.have / p.goal) * 100) + '%';
    $(k + 'Pace').textContent = paceText(k);
    let next;
    if (p.left <= 0) next = 'Done for today';
    else if (S.quiet || !isAwake()) next = 'Paused';
    else next = 'Next in ' + fmt(S.next[k] - now);
    $(k + 'Next').textContent = next;
  }
  $('streak').textContent = S.streak.count + (goalMet(S.day) ? 1 : 0);
  $('ignoredToday').textContent = Math.round(S.day.ignoredMs / MIN);
  $('snoozesToday').textContent = S.day.snoozes;
  $('mood').textContent = moodLine();

  const qb = $('quietBanner');
  qb.hidden = !S.quiet;
  if (S.quiet) {
    $('quietTxt').textContent = S.quiet.why === 'sleep'
      ? `😴 Sleeping until ${clock(S.quiet.until)}`
      : `🤫 Quiet until ${clock(S.quiet.until)}`;
  }
  $('quietBtn').hidden = !!S.quiet;

  // Browsers need one tap per visit before sound can play. Once you've
  // tapped, the banner goes away whatever the notification prompt did.
  $('setupWarn').hidden = !!audio;
}

// ---------------------------------------------------------------------------
// Nag lifecycle
// ---------------------------------------------------------------------------

function startNag(kind, since = Date.now(), voluntary = false, walkMin) {
  S.active = { kind, since, voluntary, walkMin: walkMin || (kind === 'walk' ? walkMinutes() : 0) };
  lastAlarm = 0; lastNotify = 0;
  resetProof();
  nagEl.hidden = false;
  nagEl.className = 'nag ' + kind;
  $('proofWater').hidden = kind !== 'water';
  $('proofWalk').hidden = kind !== 'walk';
  $('walkGoal').textContent = S.active.walkMin;
  $('nagMsg').textContent = voluntary ? 'Love that for you. Now prove it. 💅' : pick(LINES[kind][0]);
  if (!voluntary) notify(kind, pick(LINES[kind][0]));
  renderNag(1, Date.now() - since);
  save();
}

function renderNag(level, overdue) {
  if (!S.active) return;
  const { kind, voluntary } = S.active;
  nagEl.classList.toggle('lvl2', !voluntary && level === 2);
  nagEl.classList.toggle('lvl3', !voluntary && level === 3);
  $('nagKind').textContent = kind === 'water' ? '💧 water' : '👟 walk';
  $('nagTitle').textContent = voluntary ? (kind === 'water' ? 'Drink up, babe.' : 'Let\'s go, queen.') : TITLES[kind][level - 1];
  if (!voluntary && renderNag.level !== level) $('nagMsg').textContent = pick(LINES[kind][level - 1]);
  renderNag.level = level;
  const p = pace(kind);
  const unit = kind === 'water' ? 'ml' : 'steps';
  $('nagStatus').textContent = `${num(p.have)} / ${num(p.goal)} ${unit} today · ${paceText(kind)}`;
  const mins = Math.floor(overdue / MIN);
  $('nagOverdue').textContent = voluntary ? '' : mins >= 1 ? `You have ignored this for ${mins} minute${mins === 1 ? '' : 's'}.` : '';

  const btn = $('snoozeBtn');
  if (voluntary) { btn.textContent = 'Never mind'; btn.disabled = false; return; }
  const left = S.settings.snoozes - S.snoozed[kind];
  btn.disabled = left <= 0;
  btn.textContent = left > 0 ? `Snooze 5 min (${left} left, I'm counting)` : 'No snoozes left. Do it.';
}

function closeNag() {
  S.active = null;
  stopWalk();
  nagEl.hidden = true;
  buzz(0);
}

function completeNag(amountMl = 0) {
  const kind = S.active.kind;
  if (kind === 'water') { S.day.drinks++; S.day.waterMl += amountMl; }
  else S.day.walks++;
  S.snoozed[kind] = 0;
  closeNag();
  schedule(kind);
  chime();
  const p = pace(kind);
  if (p.left <= 0) toast(kind === 'water' ? `${num(p.goal)} ml! Water goal met 🎉💖` : `${num(p.goal)} steps! Step goal met 🎉👟`, 4000);
  else if (kind === 'water') toast(`+${num(amountMl)} ml 💖 ${num(p.left)} ml to go. See you in ${fmt(S.next.water - Date.now())}.`);
  else toast(`Walk done 🎀 ${num(p.left)} steps to go.`);
  save();
  tick();
}

$('snoozeBtn').addEventListener('click', () => {
  if (!S.active) return;
  const { kind, voluntary } = S.active;
  if (!voluntary) {
    if (S.snoozed[kind] >= S.settings.snoozes) return;
    S.snoozed[kind]++;
    S.day.snoozes++;
    S.next[kind] = Date.now() + SNOOZE_MS;
    toast(S.snoozed[kind] >= S.settings.snoozes ? 'That was your last snooze. Next time there\'s no escape.' : 'Five minutes. I\'m setting a timer.');
  }
  closeNag();
  save();
  tick();
});

// ---------------------------------------------------------------------------
// Quiet mode: meetings and sleep. Reminders that come due wait until it ends.
// ---------------------------------------------------------------------------

function startQuiet(what) {
  const now = Date.now();
  if (what === 'sleep') S.quiet = { why: 'sleep', until: nextAwakeStart(new Date(now)) };
  else S.quiet = { why: 'meeting', until: now + Number(what) * MIN };
  if (S.active) closeNag();
  $('quietPanel').hidden = true;
  toast(S.quiet.why === 'sleep' ? `Good night 🌙 See you at ${clock(S.quiet.until)}.` : `Shh 🤫 Quiet until ${clock(S.quiet.until)}. Then I'm back.`);
  save();
  tick();
}

document.querySelectorAll('[data-quiet]').forEach((b) =>
  b.addEventListener('click', () => startQuiet(b.dataset.quiet)));
$('quietBtn').addEventListener('click', () => {
  $('quietPanel').hidden = !$('quietPanel').hidden;
  $('logPanel').hidden = true;
});
$('endQuiet').addEventListener('click', () => {
  S.quiet = null;
  toast('Quiet mode off. Missed me? 💕');
  save();
  tick();
});

// ---------------------------------------------------------------------------
// Water proof: the bottle isn't see-through, so film yourself drinking
// (at least 5 seconds), then say how much went in.
// ---------------------------------------------------------------------------

let gotVideo = false;

function resetProof() {
  gotVideo = false;
  const v = $('videoPreview');
  v.hidden = true;
  v.removeAttribute('src');
  $('videoInput').value = '';
  $('videoLabel').textContent = '🎥 Film yourself drinking (5s+)';
  document.querySelectorAll('#amounts button').forEach((b) => (b.disabled = true));
  renderAmounts();
  $('startWalk').hidden = false;
  $('walkBox').hidden = true;
  $('walkLog').hidden = true;
  $('walkSteps').value = '';
  $('walkShot').value = '';
  $('walkShotLabel').textContent = '📱 Screenshot of your step count';
}
function proofInProgress() {
  return walking;
}

function renderAmounts() {
  document.querySelectorAll('#amounts button').forEach((b) => {
    b.querySelector('small').textContent = num(S.settings.bottle * Number(b.dataset.frac)) + ' ml';
  });
}

function acceptVideo() {
  if (gotVideo) return;
  gotVideo = true;
  $('videoLabel').textContent = '🎥 Got it. Retake?';
  document.querySelectorAll('#amounts button').forEach((b) => (b.disabled = false));
}

$('videoInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  gotVideo = false;
  const v = $('videoPreview');
  v.src = URL.createObjectURL(f);
  v.hidden = false;
  // Some phone formats don't report a length; then the video alone has to do.
  const fallback = setTimeout(acceptVideo, 4000);
  v.onloadedmetadata = () => {
    clearTimeout(fallback);
    const d = v.duration;
    if (Number.isFinite(d) && d < MIN_VIDEO_S) {
      toast(`That was ${d.toFixed(1)} seconds. I said drinking, not a cameo. At least ${MIN_VIDEO_S}.`);
      e.target.value = '';
      return;
    }
    acceptVideo();
  };
  v.onerror = () => { clearTimeout(fallback); acceptVideo(); };
});

document.querySelectorAll('#amounts button').forEach((b) =>
  b.addEventListener('click', () => {
    if (!gotVideo) { toast('Video first, babe. 🎥'); return; }
    completeNag(Math.round(S.settings.bottle * Number(b.dataset.frac)));
  }));

// ---------------------------------------------------------------------------
// Walk proof: a timed walk with random "still walking?" check-ins, then your
// real step count from your phone's health app, with a screenshot.
// ---------------------------------------------------------------------------

let walking = false;
let walkStart = 0;
let nextCheck = 0;
let checkDeadline = 0;
let walkTimer = 0;

const randCheck = () => Date.now() + (35 + Math.random() * 45) * 1000;

function startWalk() {
  unlockAudio();
  requestWakeLock();
  walking = true;
  walkStart = Date.now();
  nextCheck = randCheck();
  checkDeadline = 0;
  $('startWalk').hidden = true;
  $('walkBox').hidden = false;
  $('checkBtn').hidden = true;
  $('walkHint').textContent = 'Walk now. I\'ll check on you at random. Miss a check and you start over.';
  clearInterval(walkTimer);
  walkTimer = setInterval(walkTick, 250);
  walkTick();
}

function walkTick() {
  if (!walking || !S.active) return;
  const now = Date.now();
  const left = S.active.walkMin * MIN - (now - walkStart);
  $('walkLeft').textContent = fmt(Math.max(0, left)).replace('now', '0:00');
  if (checkDeadline && now > checkDeadline) {
    walkStart = now;
    nextCheck = randCheck();
    checkDeadline = 0;
    $('checkBtn').hidden = true;
    $('walkHint').textContent = 'You missed a check. The walk starts over. All of it.';
    alarm(2);
    return;
  }
  if (!checkDeadline && now >= nextCheck && left > 0) {
    checkDeadline = now + CHECK_WINDOW;
    $('checkBtn').hidden = false;
    alarm(1);
  }
  if (checkDeadline) $('checkBtn').textContent = `Still walking, babe? Tap! (${Math.ceil((checkDeadline - now) / 1000)}s)`;
  if (left <= 0 && !checkDeadline) {
    stopWalk();
    $('walkBox').hidden = true;
    $('walkLog').hidden = false;
    chime();
  }
}

function stopWalk() {
  walking = false;
  clearInterval(walkTimer);
  checkDeadline = 0;
}

$('checkBtn').addEventListener('click', () => {
  checkDeadline = 0;
  nextCheck = randCheck();
  $('checkBtn').hidden = true;
  $('walkHint').textContent = pick(['Good. Keep going.', 'Fine. Keep moving.', 'I\'ll be back. Keep walking.']);
});
$('startWalk').addEventListener('click', startWalk);

// Shared by the end of a walk and the "Log steps" panel on the home screen.
function readSteps(inputId, shotId) {
  const n = Math.round(Number($(inputId).value));
  const shot = $(shotId).files && $(shotId).files[0];
  if (!Number.isFinite(n) || n <= 0) { toast('Type in today\'s step count from your health app.'); return null; }
  if (!shot) { toast('Screenshot or it didn\'t happen. 📱'); return null; }
  if (n <= S.day.steps) { toast(`That's not more than before (${num(S.day.steps)}). Did you even walk? 🤨`); return null; }
  if (n > 60000) { toast('60,000+ steps today? Be serious, babe.'); return null; }
  return n;
}
function shotLabel(inputId, labelId) {
  $(inputId).addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) $(labelId).textContent = '📱 Screenshot added ✓';
  });
}
shotLabel('walkShot', 'walkShotLabel');
shotLabel('logShot', 'logShotLabel');

$('walkLogBtn').addEventListener('click', () => {
  const n = readSteps('walkSteps', 'walkShot');
  if (n == null) return;
  S.day.steps = n;
  completeNag();
});

$('logBtn').addEventListener('click', () => {
  $('logPanel').hidden = !$('logPanel').hidden;
  $('quietPanel').hidden = true;
});
$('logSave').addEventListener('click', () => {
  const n = readSteps('logSteps', 'logShot');
  if (n == null) return;
  const before = S.day.steps;
  S.day.steps = n;
  $('logPanel').hidden = true;
  $('logSteps').value = '';
  $('logShot').value = '';
  $('logShotLabel').textContent = '📱 Screenshot of your step count';
  toast(`+${num(n - before)} steps 💕 ${paceText('walk')}`);
  if (!S.active || S.active.kind !== 'walk') schedule('walk');
  save();
  tick();
});

// ---------------------------------------------------------------------------
// Home controls + settings
// ---------------------------------------------------------------------------

$('drinkNow').addEventListener('click', () => { unlockAudio(); startNag('water', Date.now(), true); });
$('walkNow').addEventListener('click', () => { unlockAudio(); startNag('walk', Date.now(), true); });

$('enableBtn').addEventListener('click', async () => {
  unlockAudio();
  alarm(1);
  requestWakeLock();
  $('setupWarn').hidden = true;
  toast('Sound on 💕 Keep me open and I\'ll keep you honest.');
  tick();
});

const FIELDS = [
  ['setWaterGoal', 'waterGoal', 500, 6000],
  ['setBottle', 'bottle', 100, 3000],
  ['setWater', 'water', 10, 240],
  ['setStepGoal', 'stepGoal', 1000, 40000],
  ['setWalk', 'walk', 15, 360],
  ['setSnoozes', 'snoozes', 0, 3],
];
function loadSettingsForm() {
  for (const [id, k] of FIELDS) $(id).value = S.settings[k];
  $('setStart').value = S.settings.start;
  $('setEnd').value = S.settings.end;
}
$('saveSettings').addEventListener('click', () => {
  const s = S.settings;
  for (const [id, k, lo, hi] of FIELDS) {
    const v = Number($(id).value);
    if ($(id).value !== '' && Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, Math.round(v)));
  }
  s.start = $('setStart').value || s.start;
  s.end = $('setEnd').value || s.end;
  // Changing settings doesn't get you out of a reminder that's already due.
  for (const k of KINDS) if (S.next[k] > Date.now()) schedule(k);
  loadSettingsForm();
  renderAmounts();
  save();
  toast('Saved. I\'m still watching. 👀');
});

// Any tap unlocks audio (browsers block sound until the user interacts).
document.addEventListener('pointerdown', unlockAudio, { capture: true });

// Leaving while a reminder is due? At least make it awkward.
window.addEventListener('beforeunload', (e) => {
  if (S.active && !S.active.voluntary) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { lastAlarm = 0; requestWakeLock(); tick(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

rollDay();
for (const k of KINDS) if (!S.next[k]) schedule(k);
// Don't let a reload wipe an active nag, but a voluntary one can go.
if (S.active && S.active.voluntary) S.active = null;
if (S.active) startNag(S.active.kind, S.active.since, false, S.active.walkMin);
loadSettingsForm();
tick();
setInterval(tick, 1000);
initPush();

$('pushBtn').addEventListener('click', enablePush);
$('pushTest').addEventListener('click', async () => {
  try { await pushPost('/test', { id: S.pushId }); toast('Sent. Lock your phone and wait a few seconds. 📲'); }
  catch (e) { toast('Test failed: ' + (e && e.message ? e.message : e)); }
});
