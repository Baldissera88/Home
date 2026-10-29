// The family's data and how it changes. This mirrors lommepenge/.../Model.kt line for line in spirit: both apps
// read and write the same JSON tree in the online database (see README.md), so their rules must agree exactly.

export const REPEAT = { DAILY: 'Hver dag', WEEKLY: 'Hver uge', ONCE: 'Én gang' };
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

/** All money is in øre so 2,50 kr rewards work without rounding. */
export function kr(ore) {
  const sign = ore < 0 ? '-' : '';
  const a = Math.abs(ore);
  return a % 100 === 0 ? `${sign}${a / 100} kr` : `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')} kr`;
}

/** Parses "12", "2,5" or "2.50 kr" into øre; null if it isn't a number. */
export function parseKr(text) {
  const clean = String(text).replace('kr', '').trim().replace(',', '.');
  if (clean === '') return 0;
  const v = Number(clean);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

export function krText(ore) {
  return ore % 100 === 0 ? String(ore / 100) : `${Math.floor(ore / 100)},${String(ore % 100).padStart(2, '0')}`;
}

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** ISO week, e.g. "2026-W44", the same as Java's WeekFields.ISO. */
export function weekKey(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function periodOf(repeat, d) {
  if (repeat === 'DAILY') return isoDate(d);
  if (repeat === 'WEEKLY') return weekKey(d);
  return 'once';
}

export const markKey = (chore, kid, period) => `${chore}_${kid}_${period}`;
export const nightKey = (kid, date) => `${kid}_${date}`;
export const monthKey = (d) => isoDate(d).slice(0, 7);

/** A long random code: anyone who has it can see and change the family's data, so it must not be guessable. */
export function familyCode() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

/** Accepts a typed code ("abcd-efgh-…") or a shared link ("…#familie=abcd…"). */
export function normalizeCode(raw) {
  const s = String(raw);
  const i = s.indexOf('familie=');
  const c = [...(i >= 0 ? s.slice(i + 8) : s).toLowerCase()].filter((ch) => CODE_CHARS.includes(ch)).join('');
  return c.length >= 16 ? c : null;
}

export const prettyCode = (c) => c.match(/.{1,4}/g)?.join('-') ?? '';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Writes value at a slash-separated path of the tree (null deletes), like the online database does. */
export function applyAt(root, path, value) {
  const parts = String(path).split('/').filter(Boolean);
  if (parts.length === 0) return value && typeof value === 'object' ? clone(value) : {};
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = clone(value);
  return root;
}

const entries = (o) => Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => v && typeof v === 'object');
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function familyOf(t) {
  const s = t.settings || {};
  const txns = entries(t.txns)
    .map(([id, o]) => ({ id, kid: o.kid || '', amount: o.amount | 0, text: o.text || '', emoji: o.emoji || '💰', time: o.time || 0 }))
    .sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  const sums = {};
  for (const x of txns) sums[x.kid] = (sums[x.kid] || 0) + x.amount;
  const kids = entries(t.kids)
    .map(([id, k]) => ({
      id, name: k.name || '', avatar: k.avatar || '🙂', color: k.color | 0, balance: sums[id] || 0,
      weekly: k.weekly | 0, goalName: k.goalName || '', goalEmoji: k.goalEmoji || '🎁', goalAmount: k.goalAmount | 0,
      since: k.since || '', order: k.order || 0, sleep: k.sleep !== false,
    }))
    .sort(byOrder);
  const chores = entries(t.chores)
    .map(([id, c]) => ({
      id, title: c.title || '', emoji: c.emoji || '⭐', reward: c.reward | 0,
      repeat: REPEAT[c.repeat] ? c.repeat : 'DAILY',
      kids: Object.keys(c.kids || {}).filter((k) => c.kids[k] === true), order: c.order || 0,
    }))
    .sort(byOrder);
  const marks = entries(t.marks).map(([key, m]) => ({
    key, chore: m.chore || '', kid: m.kid || '', period: m.period || '', approved: !!m.approved, time: m.time || 0,
  }));
  const nights = entries(t.nights).map(([key, n]) => ({
    key, kid: n.kid || '', date: n.date || '', ok: !!n.ok, approved: !!n.approved, time: n.time || 0,
  }));
  const sl = s.sleep || {};
  const sleep = { nightly: sl.nightly ?? 100, goal: sl.goal ?? 20, bonus: sl.bonus ?? 5000 };
  return {
    kids, chores, marks, txns, nights, sleep,
    pin: s.pin || '1234', pinChanged: !!s.pinChanged, approval: s.approval !== false,
  };
}

const kidJson = (k) => ({
  name: k.name, avatar: k.avatar, color: k.color, weekly: k.weekly, goalName: k.goalName, goalEmoji: k.goalEmoji,
  goalAmount: k.goalAmount, since: k.since, order: k.order, sleep: k.sleep !== false,
});
const choreJson = (c) => ({
  title: c.title, emoji: c.emoji, reward: c.reward, repeat: c.repeat,
  kids: Object.fromEntries(c.kids.map((k) => [k, true])), order: c.order,
});

export class Store {
  constructor({ storage = localStorage, today = () => new Date(), now = () => Date.now(), remote = null } = {}) {
    this.storage = storage;
    this.today = today;
    this.now = now;
    this.remote = remote;
    this.listeners = new Set();
    this.sync = 'OFF';
    this.code = storage.getItem('lp.code') || '';
    this.base = null;
    try { this.base = JSON.parse(storage.getItem('lp.tree')); } catch { this.base = null; }
    try { this.pending = JSON.parse(storage.getItem('lp.pending')) || []; } catch { this.pending = []; }
    this.refresh();
  }

  /** False until this device has either joined a family or started one of its own. */
  get started() { return this.base !== null || this.code !== ''; }
  get online() { return this.code !== '' && !!this.remote; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit() { for (const fn of this.listeners) fn(); }

  connect() {
    if (!this.remote || !this.code) return;
    this.remote.start(this.code, (path, data) => this.onServer(path, data), (s) => { this.sync = s; this.emit(); });
    for (const u of [...this.pending]) this.remote.send(this.code, u, (x) => this.onAck(x));
  }

  disconnect() {
    this.remote?.stop();
    this.sync = 'OFF';
  }

  /** Starts a family on this device only, with the same example chores as the Android app. */
  startLocal() {
    this.base = starterTree(this.today(), this.now());
    this.refresh();
    this.save();
  }

  createOnline() {
    const tree = this.display();
    const all = {};
    for (const k of ['settings', 'kids', 'chores', 'marks', 'txns', 'nights']) all[k] = tree[k] ?? null;
    this.base = tree;
    this.pending = [all];
    this.setCode(familyCode());
    this.save();
    this.connect();
    return this.code;
  }

  join(raw) {
    const c = normalizeCode(raw);
    if (!c) return false;
    this.disconnect();
    this.base = {};
    this.pending = [];
    this.setCode(c);
    this.refresh();
    this.save();
    this.connect();
    return true;
  }

  leave() {
    this.disconnect();
    this.base = this.display();
    this.pending = [];
    this.setCode('');
    this.refresh();
    this.save();
  }

  setCode(c) {
    this.code = c;
    this.storage.setItem('lp.code', c);
  }

  onServer(path, data) {
    this.base = applyAt(this.base || {}, path, data);
    this.refresh();
    this.save();
  }

  onAck(u) {
    const i = this.pending.indexOf(u);
    if (i >= 0) this.pending.splice(i, 1);
    this.save();
  }

  write(u) {
    if (Object.keys(u).length === 0) return;
    if (this.online) {
      this.pending.push(u);
      this.remote.send(this.code, u, (x) => this.onAck(x));
    } else {
      this.base = this.base || {};
      for (const [k, v] of Object.entries(u)) this.base = applyAt(this.base, k, v);
    }
    this.refresh();
    this.save();
  }

  display() {
    let t = clone(this.base || {});
    for (const u of this.pending) for (const [k, v] of Object.entries(u)) t = applyAt(t, k, v);
    return t;
  }

  refresh() {
    this.family = familyOf(this.display());
    this.emit();
  }

  save() {
    if (this.base !== null) this.storage.setItem('lp.tree', JSON.stringify(this.base));
    this.storage.setItem('lp.pending', JSON.stringify(this.pending));
  }

  kid(id) { return this.family.kids.find((k) => k.id === id); }
  chore(id) { return this.family.chores.find((c) => c.id === id); }

  markOf(chore, kid) {
    const key = markKey(chore.id, kid, periodOf(chore.repeat, this.today()));
    return this.family.marks.find((m) => m.key === key);
  }

  status(chore, kid) {
    const m = this.markOf(chore, kid);
    return !m ? 'TODO' : m.approved ? 'DONE' : 'PENDING';
  }

  /** Chores the kid sees; one-off jobs disappear once they're approved. */
  choresFor(kid, repeat) {
    return this.family.chores.filter((c) =>
      c.kids.includes(kid) && c.repeat === repeat && !(c.repeat === 'ONCE' && this.status(c, kid) === 'DONE'));
  }

  progress(kid) {
    const list = this.choresFor(kid, 'DAILY');
    return [list.filter((c) => this.status(c, kid) !== 'TODO').length, list.length];
  }

  txn(kid, amount, text, emoji, time = this.now()) { return { kid, amount, text, emoji, time }; }

  tick(chore, kid) {
    if (this.markOf(chore, kid)) return;
    const period = periodOf(chore.repeat, this.today());
    const key = markKey(chore.id, kid, period);
    const approved = !this.family.approval;
    const u = { [`marks/${key}`]: { chore: chore.id, kid, period, approved, time: this.now() } };
    if (approved) u[`txns/m_${key}`] = this.txn(kid, chore.reward, chore.title, chore.emoji);
    this.write(u);
  }

  pendingMarks() {
    return this.family.marks.filter((m) => !m.approved && this.chore(m.chore) && this.kid(m.kid));
  }

  approveAll(list = this.pendingMarks()) {
    const u = {};
    for (const m of list) {
      const c = this.chore(m.chore);
      if (!c) continue;
      u[`marks/${m.key}/approved`] = true;
      u[`txns/m_${m.key}`] = this.txn(m.kid, c.reward, c.title, c.emoji);
    }
    this.write(u);
  }

  approve(m) { this.approveAll([m]); }
  reject(m) { this.write({ [`marks/${m.key}`]: null }); }

  credit(kid, amount, text, emoji) {
    if (amount === 0) return;
    this.write({ [`txns/${newId()}`]: this.txn(kid, amount, text, emoji) });
  }

  history(kid) { return this.family.txns.filter((t) => t.kid === kid).reverse(); }

  /** Weekly allowance for every Monday since the kid was added (at most 12 weeks back), once per kid and Monday. */
  payAllowances() {
    const monday = mondayOf(this.today());
    const have = new Set(this.family.txns.map((t) => t.id));
    const u = {};
    for (const k of this.family.kids) {
      if (k.weekly <= 0) continue;
      const since = parseDate(k.since);
      if (!since) continue;
      let m = addDays(since, 7);
      const earliest = addDays(monday, -77);
      if (m < earliest) m = earliest;
      for (; m <= monday; m = addDays(m, 7)) {
        const id = `a_${k.id}_${isoDate(m)}`;
        if (!have.has(id)) {
          const at = new Date(m.getFullYear(), m.getMonth(), m.getDate(), 7).getTime();
          u[`txns/${id}`] = this.txn(k.id, k.weekly, 'Ugepenge', '📅', at);
        }
      }
    }
    this.write(u);
  }

  tidy() {
    const cut = addDays(this.today(), -45);
    const day = isoDate(cut);
    const week = weekKey(cut);
    const u = {};
    for (const m of this.family.marks) {
      const c = this.chore(m.chore);
      const old = !c || (c.repeat === 'DAILY' && m.period < day) || (c.repeat === 'WEEKLY' && m.period < week);
      if (old || !this.kid(m.kid)) u[`marks/${m.key}`] = null;
    }
    this.write(u);
  }

  saveKid(k) {
    const old = this.kid(k.id);
    const monday = isoDate(mondayOf(this.today()));
    if (!old) {
      const id = k.id || newId();
      const u = { [`kids/${id}`]: kidJson({ ...k, since: monday, order: this.now() }) };
      for (const c of this.family.chores) if (c.repeat !== 'ONCE') u[`chores/${c.id}/kids/${id}`] = true;
      this.write(u);
    } else {
      // A changed allowance starts next Monday rather than being paid for weeks gone by.
      const since = old.weekly !== k.weekly ? monday : old.since;
      this.write({ [`kids/${k.id}`]: kidJson({ ...k, since, order: old.order }) });
    }
  }

  removeKid(id) {
    const u = { [`kids/${id}`]: null };
    for (const m of this.family.marks) if (m.kid === id) u[`marks/${m.key}`] = null;
    for (const t of this.family.txns) if (t.kid === id) u[`txns/${t.id}`] = null;
    for (const c of this.family.chores) if (c.kids.includes(id)) u[`chores/${c.id}/kids/${id}`] = null;
    for (const n of this.family.nights) if (n.kid === id) u[`nights/${n.key}`] = null;
    this.write(u);
  }

  saveChore(c) {
    const old = this.chore(c.id);
    const id = c.id || newId();
    this.write({ [`chores/${id}`]: choreJson({ ...c, order: old ? old.order : this.now() }) });
  }

  removeChore(id) {
    const u = { [`chores/${id}`]: null };
    for (const m of this.family.marks) if (m.chore === id) u[`marks/${m.key}`] = null;
    this.write(u);
  }

  setPin(pin) { this.write({ 'settings/pin': pin, 'settings/pinChanged': true }); }
  setApproval(on) { this.write({ 'settings/approval': on }); }

  // ----- Sleeping in their own bed. A night's date is the morning after, when it gets told. -----

  todayDate() { return this.today(); }
  pendingNights() { return this.family.nights.filter((n) => !n.approved && this.kid(n.kid)); }
  waitingCount() { return this.pendingMarks().length + this.pendingNights().length; }
  night(kid, d) { return this.family.nights.find((n) => n.key === nightKey(kid, isoDate(d))); }
  nightsIn(kid, month) { return this.family.nights.filter((n) => n.kid === kid && n.date.startsWith(month)); }
  goodNights(kid, month) { return this.nightsIn(kid, month).filter((n) => n.ok && n.approved).length; }

  /** Nights in a row in their own bed, counting back from last night (or the night before, if not told yet). */
  streak(kid) {
    let d = this.today();
    if (!this.night(kid, d)) d = addDays(d, -1);
    let n = 0;
    for (let x = this.night(kid, d); x && x.ok && x.approved; x = this.night(kid, d)) { n++; d = addDays(d, -1); }
    return n;
  }

  /** The kid says they slept in their own bed last night; with approval on, a parent confirms it. */
  sleptInOwnBed(kid) {
    const d = this.today();
    if (this.night(kid, d)) return;
    if (this.family.approval) {
      const date = isoDate(d);
      this.write({ [`nights/${nightKey(kid, date)}`]: { kid, date, ok: true, approved: false, time: this.now() } });
    } else this.setNight(kid, d, true);
  }

  approveNight(n) { this.setNight(n.kid, parseDate(n.date), true); }
  rejectNight(n) { this.setNight(n.kid, parseDate(n.date), false); }

  /** A parent's say on one night (true, false, or null for not told); keeps night money and the month's bonus in step. */
  setNight(kid, d, ok) {
    const date = isoDate(d);
    const key = nightKey(kid, date);
    const rules = this.family.sleep;
    const has = (id) => this.family.txns.some((t) => t.id === id);
    const u = { [`nights/${key}`]: ok === null ? null : { kid, date, ok, approved: true, time: this.now() } };
    if (ok === true && !has(`n_${key}`) && rules.nightly > 0) u[`txns/n_${key}`] = this.txn(kid, rules.nightly, 'Sov i egen seng', '🌙');
    else if (ok !== true && has(`n_${key}`)) u[`txns/n_${key}`] = null;
    const month = monthKey(d);
    const good = this.nightsIn(kid, month).filter((n) => n.date !== date && n.ok && n.approved).length + (ok === true ? 1 : 0);
    const bonusId = `s_${kid}_${month}`;
    if (good >= rules.goal && rules.bonus > 0 && !has(bonusId)) {
      u[`txns/${bonusId}`] = this.txn(kid, rules.bonus, `Månedsbonus: ${good} nætter i egen seng`, '🏆');
    } else if (good < rules.goal && has(bonusId)) u[`txns/${bonusId}`] = null;
    this.write(u);
  }

  setSleepRules(r) { this.write({ 'settings/sleep': { nightly: r.nightly, goal: r.goal, bonus: r.bonus } }); }
}

function starterTree(today, t) {
  const monday = isoDate(mondayOf(today));
  const all = { victor: true, filucca: true };
  const chore = (title, emoji, reward, repeat, i) => [newId(), { title, emoji, reward, repeat, kids: all, order: t + i }];
  return {
    settings: { pin: '1234', pinChanged: false, approval: true },
    kids: {
      victor: { name: 'Victor', avatar: '🦁', color: 0, weekly: 2000, goalName: 'LEGO', goalEmoji: '🧱', goalAmount: 30000, since: monday, order: t },
      filucca: { name: 'Filucca', avatar: '🦄', color: 1, weekly: 2000, goalName: 'Nyt spil', goalEmoji: '🎮', goalAmount: 25000, since: monday, order: t + 1 },
    },
    chores: Object.fromEntries([
      chore('Red sengen', '🛏️', 200, 'DAILY', 0),
      chore('Børst tænder', '🦷', 100, 'DAILY', 1),
      chore('Dæk bord', '🍽️', 300, 'DAILY', 2),
      chore('Ryd op på værelset', '🧸', 1000, 'WEEKLY', 3),
      chore('Gå ud med skraldet', '🗑️', 500, 'WEEKLY', 4),
      chore('Hjælp med at støvsuge', '🧹', 1500, 'WEEKLY', 5),
    ]),
  };
}

/** Firebase Realtime Database over its REST API: an event stream for reading, PATCH for writing. */
export class FirebaseRemote {
  constructor(url) {
    this.url = url.replace(/\/+$/, '');
    this.es = null;
    this.chain = Promise.resolve();
    this.retry = null;
  }

  path(code) { return `${this.url}/families/${code}.json`; }

  start(code, onData, onState) {
    this.stop();
    onState('CONNECTING');
    const es = new EventSource(this.path(code));
    this.es = es;
    es.onopen = () => onState('ONLINE');
    es.addEventListener('put', (e) => { const o = JSON.parse(e.data); onData(o.path, o.data); onState('ONLINE'); });
    es.addEventListener('patch', (e) => {
      const o = JSON.parse(e.data);
      const base = o.path.replace(/\/+$/, '');
      for (const [k, v] of Object.entries(o.data || {})) onData(`${base}/${k}`, v);
    });
    const fail = () => {
      onState('ERROR');
      es.close();
      // The browser only retries dropped connections by itself; refused ones are retried here.
      this.retry = setTimeout(() => { if (this.es === es) this.start(code, onData, onState); }, 15000);
    };
    es.addEventListener('cancel', fail);
    es.addEventListener('auth_revoked', fail);
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) fail(); else onState('OFFLINE'); };
  }

  send(code, update, done) {
    const url = this.path(code);
    this.chain = this.chain.then(async () => {
      let wait = 2000;
      for (;;) {
        try {
          const r = await fetch(url, { method: 'PATCH', body: JSON.stringify(update), headers: { 'Content-Type': 'application/json' } });
          if (r.ok) { done(update); return; }
        } catch { /* offline: try again below */ }
        await new Promise((res) => setTimeout(res, wait));
        wait = Math.min(wait * 2, 60000);
      }
    });
  }

  stop() {
    clearTimeout(this.retry);
    this.es?.close();
    this.es = null;
  }
}
