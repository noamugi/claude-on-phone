'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const KEY = 'nag-state-v1';
const MIN = 60 * 1000;
const SNOOZE_MS = 5 * MIN;
const HOLD_MS = 15 * 1000;
const DAILY_GOAL = { water: 6, walks: 3 };

const DEFAULTS = {
  settings: { water: 45, walk: 60, steps: 300, start: '08:00', end: '22:00', snoozes: 2 },
  next: { water: 0, walk: 0 },
  // Snoozes are counted per reminder so you can't snooze forever.
  snoozed: { water: 0, walk: 0 },
  // {kind, since, voluntary}
  active: null,
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
const goalMet = (d) => d.water >= DAILY_GOAL.water && d.walks >= DAILY_GOAL.walks;
const newDay = () => ({ date: todayKey(), water: 0, walks: 0, steps: 0, ignoredMs: 0, snoozes: 0 });

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
  save();
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function isActiveHours(t = new Date()) {
  const now = t.getHours() * 60 + t.getMinutes();
  const a = minutesOf(S.settings.start);
  const b = minutesOf(S.settings.end);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
function nextActiveStart(t = new Date()) {
  const d = new Date(t);
  const a = minutesOf(S.settings.start);
  d.setHours(Math.floor(a / 60), a % 60, 0, 0);
  if (d <= t) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function schedule(kind, from = Date.now()) {
  let at = from + S.settings[kind] * MIN;
  if (!isActiveHours(new Date(at))) at = nextActiveStart(new Date(at)) + 5 * MIN;
  S.next[kind] = at;
  scheduleSystemNags();
}

// ---------------------------------------------------------------------------
// Messages. They get worse.
// ---------------------------------------------------------------------------

const LINES = {
  water: [
    ['Your cells are shrivelling.', 'Hydrate. It takes thirty seconds.', 'A glass of water. That is all I ask.'],
    ['Still nothing? Wow.', 'You are basically a raisin right now.', 'I can keep this up all day. Can you?'],
    ['THIS IS NOT GOING AWAY.', 'I WILL SCREAM UNTIL YOU DRINK.', 'EVERY SECOND YOU WAIT, I GET LOUDER.'],
  ],
  walk: [
    ['Your chair is not your friend.', 'Stand up. Walk. Now.', 'Your legs called. They miss you.'],
    ['Still sitting? Really?', 'Your spine is filing a complaint.', 'Fossils move more than you.'],
    ['GET. UP.', 'I AM NOT ASKING ANYMORE.', 'WALK OR LISTEN TO THIS FOREVER.'],
  ],
};
const TITLES = {
  water: ['Drink water.', 'DRINK. WATER.', 'DRINK. WATER. NOW.'],
  walk: ['Go walk.', 'GO. WALK.', 'GET UP AND WALK.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function moodLine() {
  const ignored = Math.round(S.day.ignoredMs / MIN);
  if (!isActiveHours()) return 'Off duty. Rest up — I\'ll be back.';
  if (ignored > 30) return `You ignored me for ${ignored} minutes today. I remember.`;
  if (S.day.snoozes > 3) return 'Lots of snoozing today. Interesting choice.';
  if (goalMet(S.day)) return 'Daily goal met. Don\'t get comfortable.';
  return 'I\'m watching you.';
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
function alarm(level) {
  if (level === 1) { tone(880, 0, 0.15, 0.25); tone(880, 0.25, 0.15, 0.25); }
  else if (level === 2) { for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 990, i * 0.18, 0.14, 0.45); }
  else { tone(600, 0, 0.45, 0.7, 'sawtooth', 1400); tone(1400, 0.45, 0.45, 0.7, 'sawtooth', 600); }
  if (navigator.vibrate) navigator.vibrate(level === 3 ? [400, 100, 400, 100, 400] : level === 2 ? [250, 100, 250] : [200]);
}
function chime() {
  tone(660, 0, 0.15, 0.25, 'sine'); tone(880, 0.12, 0.15, 0.25, 'sine'); tone(1320, 0.24, 0.3, 0.25, 'sine');
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let swReg = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; scheduleSystemNags(); }).catch(() => {});
}

async function notify(kind, body, tag = 'nag-' + kind) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = {
    body, tag, renotify: true, requireInteraction: true,
    icon: 'icon.svg', badge: 'icon.svg', vibrate: [300, 100, 300, 100, 300],
  };
  try {
    if (swReg) await swReg.showNotification(TITLES[kind][2], opts);
    else new Notification(TITLES[kind][2], opts);
  } catch {}
}

// Where the browser supports scheduled notifications (Chromium's Notification
// Triggers), pre-schedule a barrage so the nagging continues even when the page
// is asleep. Elsewhere this is a no-op and the in-page loop does the work.
async function scheduleSystemNags() {
  if (!swReg || !('TimestampTrigger' in window) || Notification.permission !== 'granted') return;
  try {
    const old = await swReg.getNotifications({ includeTriggered: false });
    old.forEach((n) => n.close());
    for (const kind of ['water', 'walk']) {
      for (let i = 0; i < 12; i++) {
        const at = S.next[kind] + i * (i < 4 ? 1 : 2) * MIN;
        await swReg.showNotification(TITLES[kind][Math.min(2, Math.floor(i / 4))], {
          body: pick(LINES[kind][Math.min(2, Math.floor(i / 4))]),
          tag: `pre-${kind}-${i}`, requireInteraction: true, icon: 'icon.svg',
          showTrigger: new window.TimestampTrigger(at),
        });
      }
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// UI refs
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const nagEl = $('nag');
let lastAlarm = 0;
let lastNotify = 0;
let lastTick = Date.now();

function fmt(ms) {
  if (ms <= 0) return 'NOW';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}
function toast(msg, ms = 2800) {
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

  // Something is due? Start nagging.
  if (!S.active && isActiveHours()) {
    const due = ['water', 'walk'].filter((k) => S.next[k] <= now).sort((a, b) => S.next[a] - S.next[b]);
    if (due.length) startNag(due[0], S.next[due[0]]);
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
  save();
}

function renderHome(now) {
  const off = !isActiveHours();
  for (const k of ['water', 'walk']) {
    $(k + 'Countdown').textContent = off ? 'zzz' : fmt(S.next[k] - now);
  }
  $('waterToday').textContent = S.day.water;
  $('stepsToday').textContent = S.day.steps;
  $('streak').textContent = S.streak.count + (goalMet(S.day) ? 1 : 0);
  $('ignoredToday').textContent = Math.round(S.day.ignoredMs / MIN);
  $('snoozesToday').textContent = S.day.snoozes;
  $('mood').textContent = moodLine();
  const needsPerm = 'Notification' in window && Notification.permission !== 'granted';
  $('setupWarn').hidden = !needsPerm && !!audio;
}

// ---------------------------------------------------------------------------
// Nag lifecycle
// ---------------------------------------------------------------------------

function startNag(kind, since = Date.now(), voluntary = false) {
  S.active = { kind, since, voluntary };
  lastAlarm = 0; lastNotify = 0;
  resetProof();
  nagEl.hidden = false;
  nagEl.className = 'nag ' + kind;
  $('proofWater').hidden = kind !== 'water';
  $('proofWalk').hidden = kind !== 'walk';
  $('stepGoal').textContent = S.settings.steps;
  $('nagMsg').textContent = voluntary ? 'Good. Now prove it.' : pick(LINES[kind][0]);
  if (!voluntary) notify(kind, pick(LINES[kind][0]));
  renderNag(1, Date.now() - since);
  save();
}

function renderNag(level, overdue) {
  if (!S.active) return;
  const { kind, voluntary } = S.active;
  nagEl.classList.toggle('lvl2', !voluntary && level === 2);
  nagEl.classList.toggle('lvl3', !voluntary && level === 3);
  $('nagKind').textContent = kind === 'water' ? '💧 WATER' : '🚶 WALK';
  $('nagTitle').textContent = voluntary ? (kind === 'water' ? 'Drink up.' : 'Let\'s go.') : TITLES[kind][level - 1];
  if (!voluntary && renderNag.level !== level) $('nagMsg').textContent = pick(LINES[kind][level - 1]);
  renderNag.level = level;
  const mins = Math.floor(overdue / MIN);
  $('nagOverdue').textContent = voluntary ? '' : mins >= 1 ? `You have ignored this for ${mins} minute${mins === 1 ? '' : 's'}.` : '';

  const btn = $('snoozeBtn');
  if (voluntary) { btn.textContent = 'Never mind'; btn.disabled = false; return; }
  const left = S.settings.snoozes - S.snoozed[kind];
  btn.disabled = left <= 0;
  btn.textContent = left > 0 ? `Snooze 5 min (${left} left — I'm counting)` : 'No snoozes left. Do it.';
}

function completeNag() {
  const kind = S.active.kind;
  if (kind === 'water') S.day.water++;
  else S.day.walks++;
  S.snoozed[kind] = 0;
  S.active = null;
  schedule(kind);
  stopSteps();
  nagEl.hidden = true;
  chime();
  if (navigator.vibrate) navigator.vibrate(0);
  toast(kind === 'water' ? `Glass #${S.day.water}. Fine. See you in ${S.settings.water} min.` : `Walk done. I'll be back in ${S.settings.walk} min.`);
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
  S.active = null;
  stopSteps();
  nagEl.hidden = true;
  if (navigator.vibrate) navigator.vibrate(0);
  scheduleSystemNags();
  save();
  tick();
});

// ---------------------------------------------------------------------------
// Water proof: photo of the glass, then hold the button while you drink.
// ---------------------------------------------------------------------------

let hasPhoto = false;
let holdStart = 0;
let holdRaf = 0;

function resetProof() {
  hasPhoto = false;
  $('photoPreview').hidden = true;
  $('photoInput').value = '';
  $('photoLabel').textContent = '📷 Photo of your full glass';
  $('holdBtn').disabled = true;
  $('holdFill').style.width = '0';
  $('holdTxt').textContent = `Hold while you drink (${HOLD_MS / 1000}s)`;
  $('startWalk').hidden = false;
  $('stepBox').hidden = true;
}
function proofInProgress() {
  return holdStart > 0 || stepping;
}

$('photoInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  hasPhoto = true;
  const img = $('photoPreview');
  img.src = URL.createObjectURL(f);
  img.hidden = false;
  $('photoLabel').textContent = '📷 Retake';
  $('holdBtn').disabled = false;
});

function holdDown(e) {
  e.preventDefault();
  if (!hasPhoto || holdStart) return;
  holdStart = performance.now();
  const step = () => {
    const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
    $('holdFill').style.width = p * 100 + '%';
    $('holdTxt').textContent = p < 1 ? `Keep drinking… ${Math.ceil((1 - p) * HOLD_MS / 1000)}s` : 'Done!';
    if (p >= 1) { holdStart = 0; completeNag(); return; }
    holdRaf = requestAnimationFrame(step);
  };
  holdRaf = requestAnimationFrame(step);
}
function holdUp() {
  if (!holdStart) return;
  cancelAnimationFrame(holdRaf);
  holdStart = 0;
  $('holdFill').style.width = '0';
  $('holdTxt').textContent = 'You stopped. Start over. ALL of it.';
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}
const hb = $('holdBtn');
hb.addEventListener('pointerdown', holdDown);
hb.addEventListener('pointerup', holdUp);
hb.addEventListener('pointerleave', holdUp);
hb.addEventListener('pointercancel', holdUp);
hb.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Walk proof: count real steps with the accelerometer. Shaking the phone
// doesn't count — steps must have a human cadence.
// ---------------------------------------------------------------------------

let stepping = false;
let steps = 0;
let smooth = 9.81;
let baseline = 9.81;
let above = false;
let lastStepAt = 0;
let lastMotionAt = 0;
let geoWatch = null;
let geoLast = null;
let geoMeters = 0;
let fallbackTimer = 0;

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  lastMotionAt = Date.now();
  const mag = Math.hypot(a.x, a.y, a.z);
  smooth = smooth * 0.75 + mag * 0.25; // low-pass to drop jitter
  baseline = baseline * 0.98 + mag * 0.02; // slow-moving gravity estimate
  const d = smooth - baseline;
  const now = performance.now();
  if (!above && d > 1.2) {
    above = true;
    const gap = now - lastStepAt;
    // Human walking: ~0.3s–2s between steps. Violent shaking (huge spikes or
    // tiny gaps) is ignored.
    if (gap > 300 && gap < 2000 && d < 9) addSteps(1);
    else if (gap >= 2000) $('stepHint').textContent = 'Keep moving. Steady pace.';
    lastStepAt = now;
  } else if (above && d < 0.3) {
    above = false;
  }
}

function addSteps(n) {
  steps += n;
  S.day.steps += n;
  $('stepCount').textContent = Math.min(steps, S.settings.steps);
  if (steps >= S.settings.steps) completeNag();
}

async function startSteps() {
  unlockAudio();
  steps = 0; stepping = true;
  $('stepCount').textContent = '0';
  $('startWalk').hidden = true;
  $('stepBox').hidden = false;
  $('stepHint').textContent = 'Keep the phone in your hand or pocket. Shaking it won\'t work.';

  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') toast('No motion access. Falling back to GPS — you\'ll have to actually go somewhere.');
    } catch {}
  }
  window.addEventListener('devicemotion', onMotion);

  // No accelerometer data after a few seconds → use GPS distance instead.
  fallbackTimer = setTimeout(() => {
    if (lastMotionAt) return;
    if (!('geolocation' in navigator)) {
      $('stepHint').textContent = 'This device can\'t count steps. Grab your phone and open me there.';
      return;
    }
    $('stepHint').textContent = 'No step sensor — tracking distance by GPS instead (≈0.7 m per step). Go outside.';
    geoWatch = navigator.geolocation.watchPosition((p) => {
      const cur = p.coords;
      if (cur.accuracy > 40) return;
      if (geoLast) {
        const m = metersBetween(geoLast, cur);
        if (m > 3 && m < 60) {
          geoMeters += m;
          const gained = Math.floor(geoMeters / 0.7) - steps;
          if (gained > 0) addSteps(gained);
        }
      }
      geoLast = cur;
    }, () => toast('Location blocked. Then go find a phone with a step sensor.'), { enableHighAccuracy: true });
  }, 4000);
}

function stopSteps() {
  stepping = false;
  window.removeEventListener('devicemotion', onMotion);
  clearTimeout(fallbackTimer);
  if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null; geoLast = null; geoMeters = 0; lastMotionAt = 0;
}

function metersBetween(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * r, dLon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

$('startWalk').addEventListener('click', startSteps);

// ---------------------------------------------------------------------------
// Home controls
// ---------------------------------------------------------------------------

$('drinkNow').addEventListener('click', () => { unlockAudio(); startNag('water', Date.now(), true); });
$('walkNow').addEventListener('click', () => { unlockAudio(); startNag('walk', Date.now(), true); });

$('enableBtn').addEventListener('click', async () => {
  unlockAudio();
  alarm(1);
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if ('Notification' in window && Notification.permission === 'denied') {
    toast('Notifications blocked. Fine. I\'ll just be louder when you open me.');
  }
  scheduleSystemNags();
  tick();
});

function loadSettingsForm() {
  const s = S.settings;
  $('setWater').value = s.water; $('setWalk').value = s.walk; $('setSteps').value = s.steps;
  $('setStart').value = s.start; $('setEnd').value = s.end; $('setSnoozes').value = s.snoozes;
}
$('saveSettings').addEventListener('click', () => {
  const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const s = S.settings;
  s.water = clamp(+$('setWater').value, 10, 240, s.water);
  s.walk = clamp(+$('setWalk').value, 15, 360, s.walk);
  s.steps = clamp(+$('setSteps').value, 50, 5000, s.steps);
  s.snoozes = clamp(+$('setSnoozes').value, 0, 3, s.snoozes);
  s.start = $('setStart').value || s.start;
  s.end = $('setEnd').value || s.end;
  // Changing settings doesn't get you out of a reminder that's already due.
  for (const k of ['water', 'walk']) if (S.next[k] > Date.now()) schedule(k);
  loadSettingsForm();
  save();
  toast('Saved. I\'m still watching.');
});

// Any tap unlocks audio (browsers block sound until the user interacts).
document.addEventListener('pointerdown', unlockAudio, { capture: true });

// Leaving while a reminder is due? At least make it awkward.
window.addEventListener('beforeunload', (e) => {
  if (S.active && !S.active.voluntary) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { lastAlarm = 0; tick(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

rollDay();
if (!S.next.water) schedule('water');
if (!S.next.walk) schedule('walk');
// Don't let a reload wipe an active nag — but a voluntary one can go.
if (S.active && S.active.voluntary) S.active = null;
if (S.active) startNag(S.active.kind, S.active.since);
loadSettingsForm();
tick();
setInterval(tick, 1000);
