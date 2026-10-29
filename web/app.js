import { html, render, useState, useEffect, useRef, useReducer } from './vendor/htm-preact-standalone.js';
import { DATABASE_URL } from './config.js';
import { VERSION } from './version.js';
import { Store, FirebaseRemote, kr, parseKr, krText, REPEAT, prettyCode, normalizeCode, isoDate, monthKey } from './store.js';

const PALETTES = [
  ['#36B9FF', '#3A6FF7'], ['#FF7EB3', '#B548F0'], ['#3EDC8A', '#0FA3B1'],
  ['#FFB347', '#FF5E62'], ['#8E7BFF', '#5B3CC4'], ['#FFD93D', '#FF8C1A'],
];
const palette = (i) => PALETTES[((i % PALETTES.length) + PALETTES.length) % PALETTES.length];
const grad = (p, deg = 135) => `linear-gradient(${deg}deg, ${p[0]}, ${p[1]})`;
const NIGHT = ['#1E1352', '#4A2DB0', '#8A5CF0'];

const CHORE_EMOJIS = ['🛏️', '🦷', '🍽️', '🧸', '🗑️', '🧹', '🧺', '👕', '🐶', '🐱', '🌱', '📚',
  '🎒', '🚿', '🧽', '🥕', '🍳', '🚲', '🎹', '⚽', '🚗', '🪴', '🧦', '⭐'];
const AVATAR_EMOJIS = ['🦁', '🦄', '🐯', '🐼', '🐸', '🦊', '🐵', '🐰', '🐻', '🐨', '🐙', '🦖', '🐲', '🦋', '🐬', '🚀', '👑', '🌈'];
const GOAL_EMOJIS = ['🎁', '🧱', '🎮', '🚲', '⚽', '🧸', '📱', '🎨', '🎧', '🛹', '🎢', '🍦'];
const CHEERS = ['Godt klaret', 'Super flot', 'Sejt', 'Wauv', 'Fantastisk', 'Du er en stjerne'];
const WEB_URL = location.origin + location.pathname;

// Sounds are synthesised so nothing needs downloading; browsers only allow them after a tap, which is when we play.
const fx = {
  ctx: null,
  audio() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && C) this.ctx = new C();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, start, dur, vol, type = 'triangle') {
    const c = this.audio();
    if (!c) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  tap() { this.tone(700, 0, 0.07, 0.15); },
  coin() { this.tone(988, 0, 0.1, 0.3); this.tone(1319, 0.08, 0.45, 0.3); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, i === 3 ? 0.8 : 0.3, 0.25)); this.tone(1319, 0.33, 0.6, 0.15); },
  say(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'da-DK';
    u.rate = 0.95;
    u.pitch = 1.15;
    const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith('da'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  },
};

const remote = DATABASE_URL ? new FirebaseRemote(DATABASE_URL) : null;
const store = new Store({ remote });
store.connect();
if (store.started) { store.tidy(); store.payAllowances(); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  store.connect();
  if (store.started) store.payAllowances();
});

function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => store.subscribe(force), []);
}

function dayLabel(time) {
  const d = new Date(time);
  const t = new Date();
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'I dag';
  if (d.toDateString() === y.toDateString()) return 'I går';
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ---------- Art ----------

function Backdrop({ colors, stars = true }) {
  const bubbles = useRef(null);
  if (!bubbles.current) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    bubbles.current = {
      b: Array.from({ length: 14 }, () => ({ left: rnd() * 100, size: 36 + rnd() * 130, dur: 18 + rnd() * 22, delay: -rnd() * 40, op: 0.05 + rnd() * 0.07 })),
      s: Array.from({ length: 26 }, () => ({ left: rnd() * 100, top: rnd() * 60, size: 6 + rnd() * 10, delay: -rnd() * 4 })),
    };
  }
  const { b, s } = bubbles.current;
  return html`<div class="backdrop" style=${{ background: `linear-gradient(180deg, ${colors.join(', ')})` }}>
    ${b.map((x) => html`<i class="bubble" style=${{ left: `${x.left}%`, width: `${x.size}px`, height: `${x.size}px`, opacity: x.op, animationDuration: `${x.dur}s`, animationDelay: `${x.delay}s` }}></i>`)}
    ${stars && s.map((x) => html`<i class="star" style=${{ left: `${x.left}%`, top: `${x.top}%`, width: `${x.size}px`, height: `${x.size}px`, animationDelay: `${x.delay}s` }}></i>`)}
  </div>`;
}

function Piggy({ wiggle = 0, size = 150 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!wiggle || !el) return;
    el.classList.remove('wiggle');
    void el.getBoundingClientRect();
    el.classList.add('wiggle');
  }, [wiggle]);
  const dark = '#E0619A';
  const body = '#F79CC4';
  return html`<svg class="piggy" width=${size} height=${size * 0.85} viewBox="0 0 200 170" aria-hidden="true">
    <defs><radialGradient id="pigBody" cx="0.4" cy="0.3" r="0.75">
      <stop offset="0" stop-color="#FFD3E6" /><stop offset="0.55" stop-color=${body} /><stop offset="1" stop-color=${dark} />
    </radialGradient></defs>
    <ellipse cx="102" cy="156" rx="62" ry="7" fill="rgba(0,0,0,.16)" />
    <g class="pig-bob"><g ref=${ref} class="pig-tilt">
      ${[48, 74, 120, 146].map((x) => html`<rect x=${x} y="115" width="20" height="34" rx="6" fill=${dark} />`)}
      <path d="M22 96 q-16 -2 -12 -16 q5 -11 15 -2" stroke=${dark} stroke-width="4.5" stroke-linecap="round" fill="none" />
      <polygon points="88,53 100,20 116,51" fill=${dark} />
      <ellipse cx="100" cy="88" rx="80" ry="48" fill="url(#pigBody)" />
      <polygon points="112,54 132,19 148,60" fill=${body} />
      <polygon points="120,53 132,31 140,56" fill=${dark} opacity="0.6" />
      <ellipse cx="176" cy="88" rx="16" ry="15" fill="#F06FA6" />
      <ellipse cx="171" cy="88" rx="3" ry="5" fill="#B83E74" />
      <ellipse cx="182" cy="88" rx="3" ry="5" fill="#B83E74" />
      <circle cx="140" cy="73" r="6.4" fill="#2B2140" />
      <circle cx="142" cy="71" r="2.2" fill="#fff" />
      <circle cx="144" cy="95" r="9" fill="#FF6F9F" opacity="0.45" />
      <rect x="76" y="45" width="40" height="6" rx="3" fill="#9C2F5E" />
      <ellipse cx="58" cy="62" rx="18" ry="7.6" fill="#fff" opacity="0.35" />
    </g></g>
  </svg>`;
}

function Coin({ size = 22, cls = '' }) {
  return html`<svg class=${`coin ${cls}`} width=${size} height=${size} viewBox="0 0 40 40" aria-hidden="true">
    <defs><radialGradient id="coinG" cx="0.35" cy="0.35" r="0.8">
      <stop offset="0" stop-color="#FFF3B0" /><stop offset="0.5" stop-color="#FFC107" /><stop offset="1" stop-color="#F2A900" />
    </radialGradient></defs>
    <circle cx="20" cy="21.6" r="19" fill="#E09B00" />
    <circle cx="20" cy="20" r="18.4" fill="url(#coinG)" />
    <circle cx="20" cy="20" r="13.5" fill="none" stroke="#E6A100" stroke-width="1.6" />
    <text x="20" y="24.5" text-anchor="middle" font-size="12.5" font-weight="900" fill="#A86A00" font-family="system-ui, sans-serif">kr</text>
  </svg>`;
}

function Ring({ done, total, size = 58, track, fill, children }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return html`<div class="ring" style=${{ width: `${size}px`, height: `${size}px` }}>
    <svg viewBox="0 0 58 58" width=${size} height=${size}>
      <circle cx="29" cy="29" r=${r} fill="none" stroke=${track} stroke-width="7" />
      <circle cx="29" cy="29" r=${r} fill="none" stroke=${fill} stroke-width="7" stroke-linecap="round"
        stroke-dasharray=${c} stroke-dashoffset=${c * (1 - frac)} transform="rotate(-90 29 29)" class="ring-fill" />
    </svg>
    <div class="ring-label">${children}</div>
  </div>`;
}

/** Confetti and coins burst from the top third of the screen. */
function confetti() {
  const cv = document.getElementById('confetti');
  const g = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  const W = cv.width;
  const H = cv.height;
  const colors = ['#FF5E62', '#FFC107', '#3EDC8A', '#36B9FF', '#B548F0', '#FF7EB3'];
  const parts = Array.from({ length: 110 }, (_, i) => {
    const a = -Math.PI * (0.08 + Math.random() * 0.84);
    const sp = H * (0.55 + Math.random() * 0.75);
    return { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spin: (Math.random() - 0.5) * 1400, coin: i % 9 === 0, color: colors[i % colors.length] };
  });
  const start = performance.now();
  const run = (now) => {
    const t = Math.min(1, (now - start) / 2400);
    const time = t * 2.4;
    g.clearRect(0, 0, W, H);
    if (t >= 1) return;
    g.globalAlpha = 1 - t * t * t;
    for (const p of parts) {
      const x = W / 2 + p.vx * time;
      const y = H * 0.32 + p.vy * time + 0.7 * H * time * time;
      if (p.coin) {
        g.fillStyle = '#E09B00'; g.beginPath(); g.arc(x, y + 2 * dpr, 8 * dpr, 0, 7); g.fill();
        g.fillStyle = '#FFC107'; g.beginPath(); g.arc(x, y, 7.2 * dpr, 0, 7); g.fill();
      } else {
        g.save(); g.translate(x, y); g.rotate((p.spin * time * Math.PI) / 180);
        g.fillStyle = p.color; g.fillRect(-4.5 * dpr, -2.5 * dpr, 9 * dpr, 5 * dpr); g.restore();
      }
    }
    requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function useCountUp(value) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - start) / 1100);
      const e = 1 - Math.pow(1 - t, 3);
      const v = Math.round(a + (value - a) * e);
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

const Avatar = ({ kid, size }) => html`<div class="avatar" style=${{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.55}px` }}>${kid.avatar}</div>`;

const BackButton = ({ onClick }) => html`<button class="round glass" onClick=${() => { fx.tap(); onClick(); }} aria-label="Tilbage">←</button>`;

// ---------- Kids ----------

function Welcome({ go }) {
  const [code, setCode] = useState(normalizeCode(location.hash) ? prettyCode(normalizeCode(location.hash)) : '');
  const [bad, setBad] = useState(false);
  return html`<div class="page">
    <${Backdrop} colors=${NIGHT} />
    <div class="content center">
      <div class="hero"><${Coin} size=${38} cls="drop" /><${Piggy} /></div>
      <h1>Pligter & Lommepenge</h1>
      ${DATABASE_URL && html`<div class="glass card-pad stack">
        <b>Har I familien på en anden telefon?</b>
        <span class="muted-w">Skriv familiekoden fra forældre-indstillingerne, eller åbn det delte link.</span>
        <input class=${`field ${bad ? 'bad' : ''}`} placeholder="abcd-efgh-…" value=${code} autocapitalize="off" autocomplete="off"
          onInput=${(e) => { setCode(e.target.value); setBad(false); }} />
        <button class="btn white" onClick=${() => { if (store.join(code)) { fx.coin(); go('home'); } else setBad(true); }}>Forbind</button>
      </div>`}
      <button class="pill glass" onClick=${() => { fx.tap(); store.startLocal(); go('home'); }}>
        ${DATABASE_URL ? 'Start en ny familie her' : 'Kom i gang'}
      </button>
      <p class="tip">💡 På iPhone: tryk på Del-knappen og vælg <b>Føj til hjemmeskærm</b>, så ligger den som en app.</p>
    </div>
  </div>`;
}

function Home({ go }) {
  const fam = store.family;
  const loading = store.code && fam.kids.length === 0;
  return html`<div class="page">
    <${Backdrop} colors=${NIGHT} />
    <div class="content center">
      <div class="hero"><${Coin} size=${38} cls="drop" /><${Piggy} /></div>
      <h1>Pligter & Lommepenge</h1>
      <p class="sub">Hvem er du?</p>
      ${loading && html`<div class="glass card-pad">${store.sync === 'ERROR' ? '⚠️ Kunne ikke hente familien. Tjek familiekoden under Forældre.' : '⏳ Henter familiens data…'}</div>`}
      ${fam.kids.map((k) => {
        const [done, total] = store.progress(k.id);
        const waiting = fam.marks.some((m) => m.kid === k.id && !m.approved) || fam.nights.some((n) => n.kid === k.id && !n.approved);
        return html`<button class="kid-card" key=${k.id} style=${{ background: grad(palette(k.color)), '--glow': palette(k.color)[1] }}
          onClick=${() => { fx.tap(); go(`kid:${k.id}`); }}>
          <${Avatar} kid=${k} size=${80} />
          <div class="grow left">
            <div class="kid-name">${k.name}</div>
            <div class="row gap6"><${Coin} size=${22} /><b class="kid-bal">${kr(k.balance)}</b></div>
            <div class="kid-sub">${total === 0 ? 'Ingen pligter i dag' : done === total ? 'Alt klaret i dag! 🌟' : `${done} af ${total} pligter i dag`}</div>
          </div>
          <div class="ring-wrap">
            <${Ring} done=${done} total=${total} track="rgba(255,255,255,.25)" fill="#fff">${total > 0 && done === total ? '⭐' : `${done}/${total}`}<//>
            ${waiting && html`<span class="badge">⏳</span>`}
          </div>
        </button>`;
      })}
      <button class="pill glass" onClick=${() => { fx.tap(); go('pin'); }}>🔒 Forældre</button>
      <div class="version">Web-version ${VERSION}</div>
      ${store.code && html`<div class="sync-note">${{ ONLINE: '☁️ Delt online', CONNECTING: '☁️ Forbinder…', ERROR: '⚠️ Ingen forbindelse' }[store.sync] || '☁️ Offline – gemmer til senere'}</div>`}
    </div>
  </div>`;
}

function KidPage({ id, go }) {
  const kid = store.kid(id);
  const [party, setParty] = useState(0);
  if (!kid) return html`<${Home} go=${go} />`;
  const p = palette(kid.color);
  const daily = store.choresFor(kid.id, 'DAILY');
  const weekly = store.choresFor(kid.id, 'WEEKLY');
  const extra = store.choresFor(kid.id, 'ONCE');
  const [done, total] = store.progress(kid.id);
  const history = store.history(kid.id).slice(0, 8);

  const tick = (c) => {
    if (store.status(c, kid.id) !== 'TODO') return;
    store.tick(c, kid.id);
    setParty((x) => x + 1);
    confetti();
    const [d, t] = store.progress(kid.id);
    if (c.repeat === 'DAILY' && d === t) {
      fx.fanfare();
      fx.say(`Hurra ${kid.name}! Du har klaret alle dine pligter i dag!`);
    } else {
      fx.coin();
      fx.say(`${CHEERS[Math.floor(Math.random() * CHEERS.length)]}, ${kid.name}!`);
    }
  };
  const list = (chores) => chores.map((c) => html`<${ChoreCard} key=${c.id} chore=${c} status=${store.status(c, kid.id)} onTick=${() => tick(c)} />`);

  return html`<div class="page">
    <${Backdrop} colors=${[p[0], p[1], p[1]]} stars=${false} />
    <div class="content stack">
      <div class="row gap12">
        <${BackButton} onClick=${() => go('home')} />
        <h2 class="grow ellipsis">Hej ${kid.name}!</h2>
        <${Avatar} kid=${kid} size=${52} />
      </div>
      <${BankCard} kid=${kid} wiggle=${party} />
      ${kid.sleep && html`<${SleepCard} kid=${kid} onParty=${() => { setParty((x) => x + 1); confetti(); }} />`}
      ${kid.goalAmount > 0 && html`<${GoalCard} kid=${kid} color=${p[1]} />`}
      <div class="section"><span>I dag</span>${total > 0 && html`<small>${done} af ${total}</small>`}</div>
      ${daily.length === 0 && html`<div class="glass card-pad">Ingen daglige pligter – nyd dagen! ☀️</div>`}
      ${total > 0 && done === total && html`<div class="all-done"><span class="big-emoji">🏆</span><div>
        <b>Alle dagens pligter klaret!</b>
        <div>${daily.some((c) => store.status(c, kid.id) === 'PENDING') ? 'Mor eller far godkender, så kommer pengene i grisen.' : 'Pengene er i sparegrisen.'}</div>
      </div></div>`}
      ${list(daily)}
      ${weekly.length > 0 && html`<div class="section"><span>Denne uge</span></div>${list(weekly)}`}
      ${extra.length > 0 && html`<div class="section"><span>Ekstra opgaver</span><small>tjen lidt ekstra</small></div>${list(extra)}`}
      ${history.length > 0 && html`<div class="section"><span>Sparegrisens dagbog</span></div>
        <div class="card history">${history.map((t) => html`<div class="hrow" key=${t.id}>
          <span class="h-emoji">${t.emoji}</span>
          <div class="grow"><div class="h-text">${t.text}</div><small>${dayLabel(t.time)}</small></div>
          <b class=${t.amount > 0 ? 'plus' : 'minus'}>${t.amount > 0 ? '+' : ''}${kr(t.amount)}</b>
        </div>`)}</div>`}
    </div>
  </div>`;
}

function BankCard({ kid, wiggle }) {
  const shown = useCountUp(kid.balance);
  return html`<div class="glass bank">
    <${Piggy} size=${128} wiggle=${wiggle} />
    <div>
      <div class="muted-w">I sparegrisen</div>
      <div class=${`balance ${shown % 100 ? 'small' : ''}`}>${kr(shown)}</div>
      ${kid.weekly > 0 && html`<div class="muted-w sm">+${kr(kid.weekly)} hver mandag</div>`}
    </div>
  </div>`;
}

function GoalCard({ kid, color }) {
  const frac = Math.max(0, Math.min(1, kid.balance / kid.goalAmount));
  const left = kid.goalAmount - kid.balance;
  return html`<div class="card card-pad">
    <div class="row gap12">
      <span class="big-emoji">${kid.goalEmoji}</span>
      <div class="grow"><small class="muted">Jeg sparer op til</small><div class="goal-name">${kid.goalName || 'noget godt'}</div></div>
      <b class="pct" style=${{ color }}>${Math.floor(frac * 100)}%</b>
    </div>
    <div class="bar"><div class="bar-fill" style=${{ width: `${Math.max(4, frac * 100)}%` }}></div></div>
    <small class="muted strong">${left <= 0 ? 'Du har sparet nok! 🎉 Spørg mor eller far.' : `${kr(Math.max(0, kid.balance))} af ${kr(kid.goalAmount)} · ${kr(left)} tilbage`}</small>
  </div>`;
}

function ChoreCard({ chore, status, onTick }) {
  return html`<button class=${`chore ${status.toLowerCase()}`} disabled=${status !== 'TODO'} onClick=${onTick}>
    <span class="chore-icon">${chore.emoji}</span>
    <div class="grow left">
      <div class="chore-title">${chore.title}</div>
      ${status === 'TODO' && html`<span class="reward"><${Coin} size=${16} /> +${kr(chore.reward)}</span>`}
      ${status === 'PENDING' && html`<span class="state pending-t">⏳ Venter på godkendelse</span>`}
      ${status === 'DONE' && html`<span class="state done-t">✓ ${kr(chore.reward)} i grisen</span>`}
    </div>
    <span class="check">${status === 'PENDING' ? '⏳' : status === 'DONE' ? '✓' : ''}</span>
  </button>`;
}

// ---------- Sleeping in their own bed ----------

const MONTHS = ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'December'];
const monthName = (m) => MONTHS[+m.slice(5, 7) - 1];
function shiftMonth(m, by) {
  const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + by, 1);
  return monthKey(d);
}

/** The month as a grid of nights: a star for their own bed, a cloud for a night in the big bed. */
function NightCalendar({ month, kid, dark, onDay }) {
  const today = store.todayDate();
  const todayIso = isoDate(today);
  const y = +month.slice(0, 4);
  const mo = +month.slice(5, 7) - 1;
  const days = new Date(y, mo + 1, 0).getDate();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7;
  const byDate = Object.fromEntries(store.nightsIn(kid.id, month).map((n) => [n.date, n]));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(y, mo, i + 1))];
  return html`<div class=${`cal ${dark ? 'dark' : ''}`}>
    ${['M', 'T', 'O', 'T', 'F', 'L', 'S'].map((d) => html`<b class="cal-h">${d}</b>`)}
    ${cells.map((d) => {
      if (!d) return html`<span></span>`;
      const iso = isoDate(d);
      const n = byDate[iso];
      const future = iso > todayIso;
      const cls = n ? (n.ok && n.approved ? 'good' : n.ok ? 'wait' : 'cloud') : `empty ${iso === todayIso ? 'today' : ''} ${future ? 'future' : ''}`;
      const label = n ? (n.ok && n.approved ? '⭐' : n.ok ? '⏳' : '☁️') : d.getDate();
      return onDay && !future
        ? html`<button class=${`day ${cls}`} onClick=${() => onDay(d)}>${label}</button>`
        : html`<span class=${`day ${cls}`}>${label}</span>`;
    })}
  </div>`;
}

/** The kid's own-bed month: stars so far, how close the bonus is, and the morning button. */
function SleepCard({ kid, onParty }) {
  const today = store.todayDate();
  const month = monthKey(today);
  const rules = store.family.sleep;
  const good = store.goodNights(kid.id, month);
  const streak = store.streak(kid.id);
  const tonight = store.night(kid.id, today);
  const tell = () => {
    store.sleptInOwnBed(kid.id);
    onParty();
    const now = store.goodNights(kid.id, month);
    if (good < rules.goal && now >= rules.goal) {
      fx.fanfare();
      fx.say(`Hurra ${kid.name}! Du har sovet i din egen seng ${now} nætter og får månedens bonus!`);
    } else {
      fx.coin();
      fx.say(`Hvor er du sej, ${kid.name}! Du sov i din egen seng.`);
    }
  };
  const note = !tonight ? null : !tonight.approved ? '⏳ Mor eller far skal lige se det'
    : tonight.ok ? '⭐ Flot! Du sov i din egen seng i nat' : '☁️ I nat gik det ikke – i aften prøver vi igen!';
  return html`<div class="sleep stack">
    <div class="row gap12">
      <span class="big-emoji">🌙</span>
      <div class="grow"><div class="sleep-title">Min egen seng</div>
        <small>${monthName(month)}${streak > 1 ? ` · ${streak} nætter i træk 🔥` : ''}</small></div>
      <b class="sleep-count">${good}/${rules.goal}</b>
    </div>
    <div class="bar dark"><div class="bar-fill" style=${{ width: `${Math.max(3, Math.min(100, (good / rules.goal) * 100))}%` }}></div></div>
    <small class="strong-w">${good >= rules.goal ? `🏆 Månedens bonus på ${kr(rules.bonus)} er i grisen!`
      : `${rules.goal - good} ${rules.goal - good === 1 ? 'nat' : 'nætter'} mere giver ${kr(rules.bonus)} i bonus${rules.nightly > 0 ? ` · +${kr(rules.nightly)} pr. nat` : ''}`}</small>
    <${NightCalendar} month=${month} kid=${kid} dark=${true} />
    ${note ? html`<div class="sleep-note">${note}</div>`
      : html`<button class="sleep-btn" onClick=${tell}>Jeg sov i min egen seng i nat! 🌟</button>`}
  </div>`;
}

function NightsDialog({ kid, close }) {
  useStore();
  const now = monthKey(store.todayDate());
  const [month, setMonth] = useState(now);
  const rules = store.family.sleep;
  const good = store.goodNights(kid.id, month);
  const cycle = (d) => {
    fx.tap();
    const n = store.night(kid.id, d);
    store.setNight(kid.id, d, !n ? true : n.ok && n.approved ? false : n.ok ? true : null);
  };
  return html`<${Modal} title=${`${kid.name}s nætter`} close=${close}>
    <div class="row gap8">
      <button class="btn purple outline" onClick=${() => { fx.tap(); setMonth(shiftMonth(month, -1)); }}>‹</button>
      <b class="grow center-t">${monthName(month)} ${month.slice(0, 4)}</b>
      <button class="btn purple outline" disabled=${month >= now} onClick=${() => { fx.tap(); setMonth(shiftMonth(month, 1)); }}>›</button>
    </div>
    <${NightCalendar} month=${month} kid=${kid} dark=${false} onDay=${cycle} />
    <b>${good} af ${rules.goal} nætter i egen seng${good >= rules.goal ? ' – bonus givet 🏆' : ''}</b>
    <div class="muted">Tryk på en nat for at skifte: ⭐ egen seng → ☁️ kom ind → ikke registreret.</div>
    <div class="row"><span class="grow"></span><button class="btn purple" onClick=${close}>Luk</button></div>
  <//>`;
}

function SleepRulesCard() {
  const r = store.family.sleep;
  const [nightly, setNightly] = useState(krText(r.nightly));
  const [goal, setGoal] = useState(String(r.goal));
  const [bonus, setBonus] = useState(krText(r.bonus));
  const [saved, setSaved] = useState(false);
  const n = parseKr(nightly);
  const g = /^\d+$/.test(goal) ? +goal : null;
  const b = parseKr(bonus);
  const ok = n !== null && n >= 0 && g !== null && g >= 1 && g <= 31 && b !== null && b >= 0;
  const edit = (set) => (e) => { set(e.target.value); setSaved(false); };
  return html`<div class="card card-pad stack">
    <div class="row gap12"><span class="big-emoji">🌙</span><div><b>Sove i egen seng</b>
      <div class="muted">Lidt for hver nat og en bonus, når månedens mål er nået.</div></div></div>
    <div class="row gap8">
      <label class="grow">Pr. nat (kr)<input class=${`field ${n === null ? 'bad' : ''}`} inputmode="decimal" value=${nightly} onInput=${edit(setNightly)} /></label>
      <label class="grow">Nætter<input class=${`field ${g === null || g < 1 || g > 31 ? 'bad' : ''}`} inputmode="numeric" value=${goal} onInput=${edit(setGoal)} /></label>
      <label class="grow">Bonus (kr)<input class=${`field ${b === null ? 'bad' : ''}`} inputmode="decimal" value=${bonus} onInput=${edit(setBonus)} /></label>
    </div>
    <div class="row gap8">
      <span class=${`grow ${saved ? 'plus' : 'muted'}`}>${saved ? '✓ Gemt' : 'Bonus gives ved det antal nætter på en måned.'}</span>
      <button class="btn purple" disabled=${!ok} onClick=${() => { fx.coin(); store.setSleepRules({ nightly: n, goal: g, bonus: b }); setSaved(true); }}>Gem</button>
    </div>
  </div>`;
}

// ---------- Parents ----------

function Pin({ go }) {
  const [entered, setEntered] = useState('');
  const [wrong, setWrong] = useState(false);
  const press = (d) => {
    fx.tap();
    setWrong(false);
    if (entered.length >= 4) return;
    const e = entered + d;
    setEntered(e);
    if (e.length === 4) {
      if (e === store.family.pin) go('parent', true);
      else setTimeout(() => { setWrong(true); setEntered(''); }, 150);
    }
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return html`<div class="page">
    <${Backdrop} colors=${NIGHT} />
    <div class="content center pin">
      <div class="row full"><${BackButton} onClick=${() => go('home')} /></div>
      <div class="big-emoji">🔒</div>
      <h2>Kun for forældre</h2>
      <p class=${wrong ? 'wrong' : 'muted-w'}>${wrong ? 'Forkert kode – prøv igen' : 'Indtast koden'}</p>
      <div class=${`dots ${wrong ? 'shake' : ''}`}>${[0, 1, 2, 3].map((i) => html`<i class=${i < entered.length ? 'on' : ''}></i>`)}</div>
      <div class="keypad">${keys.map((k) => (k === '' ? html`<span></span>`
        : html`<button class="key glass" onClick=${() => (k === '⌫' ? (fx.tap(), setEntered(entered.slice(0, -1))) : press(k))}>${k}</button>`))}</div>
      ${!store.family.pinChanged && html`<p class="tip">Standardkoden er 1234. Skift den under Indstillinger.</p>`}
    </div>
  </div>`;
}

function Parent({ go }) {
  const pending = store.pendingMarks();
  const nights = store.pendingNights();
  const waiting = pending.length + nights.length;
  const [tab, setTab] = useState(waiting ? 0 : 1);
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);
  const names = [waiting ? `Godkend (${waiting})` : 'Godkend', 'Pligter', 'Børn', 'Indstillinger'];
  return html`<div class="page parent">
    <header class="p-head">
      <div class="row"><h2 class="grow">Forældre</h2><button class="pill glass sm" onClick=${() => { fx.tap(); go('home'); }}>Luk ✕</button></div>
      <nav class="tabs">${names.map((n, i) => html`<button class=${tab === i ? 'on' : ''} onClick=${() => { fx.tap(); setTab(i); }}>${n}</button>`)}</nav>
    </header>
    <main class="p-body stack">
      ${tab === 0 && html`<${ApproveTab} pending=${pending} nights=${nights} />`}
      ${tab === 1 && html`<${ChoresTab} edit=${(c) => setModal(html`<${ChoreEditor} start=${c} close=${close} />`)} />`}
      ${tab === 2 && html`<${KidsTab} edit=${(k) => setModal(html`<${KidEditor} start=${k} close=${close} />`)}
        money=${(k, plus) => setModal(html`<${MoneyDialog} kid=${k} plus=${plus} close=${close} />`)}
        nights=${(k) => setModal(html`<${NightsDialog} kid=${k} close=${close} />`)} />`}
      ${tab === 3 && html`<${SettingsTab} />`}
    </main>
    ${modal}
  </div>`;
}

const Note = ({ emoji, title, children }) => html`<div class="card card-pad row top gap12">
  <span class="big-emoji">${emoji}</span><div><b>${title}</b><div class="muted">${children}</div></div>
</div>`;

function ApproveTab({ pending, nights }) {
  if (!pending.length && !nights.length) return html`<${Note} emoji="🎉" title="Intet at godkende lige nu">Når børnene krydser en pligt af, dukker den op her.<//>`;
  return html`
    <button class="btn green wide" onClick=${() => { fx.coin(); store.approveAll(); nights.forEach((n) => store.approveNight(n)); }}>✓ Godkend alle (${pending.length + nights.length})</button>
    ${nights.map((n) => {
      const kid = store.kid(n.kid);
      return html`<div class="card card-pad stack" key=${n.key}>
        <div class="row gap12">
          <div class="avatar sm" style=${{ background: grad(palette(kid.color)) }}>${kid.avatar}</div>
          <div class="grow"><small class="muted">${kid.name} · ${dayLabel(n.time)}</small><div class="strong ellipsis">🌙 Sov i egen seng i nat</div></div>
          ${store.family.sleep.nightly > 0 && html`<b class="gold">+${kr(store.family.sleep.nightly)}</b>`}
        </div>
        <div class="row gap8">
          <button class="btn green grow" onClick=${() => { fx.coin(); store.approveNight(n); }}>✓ Godkend</button>
          <button class="btn red outline grow" onClick=${() => { fx.tap(); store.rejectNight(n); }}>☁️ Kom ind</button>
        </div>
      </div>`;
    })}
    ${pending.map((m) => {
      const kid = store.kid(m.kid);
      const c = store.chore(m.chore);
      return html`<div class="card card-pad stack" key=${m.key}>
        <div class="row gap12">
          <div class="avatar sm" style=${{ background: grad(palette(kid.color)) }}>${kid.avatar}</div>
          <div class="grow"><small class="muted">${kid.name} · ${dayLabel(m.time)}</small><div class="strong ellipsis">${c.emoji} ${c.title}</div></div>
          <b class="gold">+${kr(c.reward)}</b>
        </div>
        <div class="row gap8">
          <button class="btn green grow" onClick=${() => { fx.coin(); store.approve(m); }}>✓ Godkend</button>
          <button class="btn red outline grow" onClick=${() => { fx.tap(); store.reject(m); }}>✕ Ikke klaret</button>
        </div>
      </div>`;
    })}`;
}

function ChoresTab({ edit }) {
  const fam = store.family;
  return html`
    <button class="btn purple wide" onClick=${() => { fx.tap(); edit({ id: '', title: '', emoji: '⭐', reward: 500, repeat: 'DAILY', kids: fam.kids.map((k) => k.id) }); }}>＋ Ny pligt</button>
    ${Object.keys(REPEAT).map((r) => {
      const list = fam.chores.filter((c) => c.repeat === r);
      if (!list.length) return null;
      return html`<div class="group">${REPEAT[r]}</div>
        ${list.map((c) => {
          const who = fam.kids.filter((k) => c.kids.includes(k.id));
          return html`<button class="card card-pad row gap12 list-btn" key=${c.id} onClick=${() => { fx.tap(); edit(c); }}>
            <span class="chore-icon sm">${c.emoji}</span>
            <div class="grow left"><div class="strong ellipsis">${c.title}</div>
              <small class="muted ellipsis">${who.length ? who.map((k) => `${k.avatar} ${k.name}`).join('  ') : 'Ingen børn valgt'}</small></div>
            <b class="gold">${kr(c.reward)}</b><span class="chev">›</span>
          </button>`;
        })}`;
    })}`;
}

function KidsTab({ edit, money, nights }) {
  const fam = store.family;
  const addKid = () => {
    fx.tap();
    const used = new Set(fam.kids.map((k) => k.color));
    edit({ id: '', name: '', avatar: AVATAR_EMOJIS.find((a) => !fam.kids.some((k) => k.avatar === a)) || '🙂',
      color: [0, 1, 2, 3, 4, 5].find((i) => !used.has(i)) ?? 0, weekly: 2000, goalName: '', goalEmoji: '🎁', goalAmount: 0, sleep: true });
  };
  return html`
    ${fam.kids.map((k) => html`<div class="card kid-admin" key=${k.id}>
      <div class="row gap12 kid-admin-head" style=${{ background: grad(palette(k.color)) }}>
        <${Avatar} kid=${k} size=${56} />
        <div class="grow"><div class="kid-name sm">${k.name}</div><small>Ugepenge: ${kr(k.weekly)}</small></div>
        <b class="kid-bal lg">${kr(k.balance)}</b>
      </div>
      <div class="row gap8 card-pad">
        <button class="btn green grow" onClick=${() => { fx.tap(); money(k, true); }}>＋ Bonus</button>
        <button class="btn red grow" onClick=${() => { fx.tap(); money(k, false); }}>− Udbetal</button>
        ${k.sleep && html`<button class="btn purple outline" onClick=${() => { fx.tap(); nights(k); }} aria-label="Nætter">🌙</button>`}
        <button class="btn purple outline" onClick=${() => { fx.tap(); edit(k); }}>Ret</button>
      </div>
      ${store.history(k.id).slice(0, 3).map((t) => html`<div class="row mini-h" key=${t.id}>
        <span class="grow ellipsis muted">${t.emoji} ${t.text}</span><b class=${t.amount > 0 ? 'plus' : 'minus'}>${t.amount > 0 ? '+' : ''}${kr(t.amount)}</b>
      </div>`)}
    </div>`)}
    <button class="btn purple wide" onClick=${addKid}>＋ Tilføj barn</button>`;
}

function Toggle({ on, onChange }) {
  return html`<button class=${`toggle ${on ? 'on' : ''}`} role="switch" aria-checked=${on} onClick=${() => onChange(!on)}><i></i></button>`;
}

function SettingsTab() {
  const [pin, setPin] = useState('');
  const [saved, setSaved] = useState(false);
  const fam = store.family;
  return html`
    <${OnlineCard} />
    <${SleepRulesCard} />
    <div class="card card-pad row gap12">
      <div class="grow"><b>Forældre godkender pligter</b>
        <div class="muted">${fam.approval ? 'Pengene kommer først i grisen, når I har godkendt.' : 'Pengene kommer i grisen, så snart barnet krydser af.'}</div></div>
      <${Toggle} on=${fam.approval} onChange=${(v) => { fx.tap(); store.setApproval(v); }} />
    </div>
    <div class="card card-pad stack">
      <b>Skift forældrekode</b>
      <div class="row gap8">
        <input class="field grow" inputmode="numeric" type="password" maxlength="4" placeholder="Ny kode (4 cifre)" value=${pin}
          onInput=${(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setSaved(false); }} />
        <button class="btn purple" disabled=${pin.length !== 4} onClick=${() => { fx.coin(); store.setPin(pin); setPin(''); setSaved(true); }}>Gem</button>
      </div>
      ${saved && html`<b class="plus">✓ Koden er gemt</b>`}
    </div>
    <${Note} emoji="💡" title="Sådan virker det">
      Ugepenge lægges automatisk i grisen hver mandag. Daglige pligter nulstilles hver morgen, ugentlige hver mandag.
      ${store.online ? ' Alt deles online med jeres andre telefoner.' : ' Alt gemmes kun i denne browser.'}
      <br /><br />Web-version ${VERSION}
    <//>`;
}

function OnlineCard() {
  const [joining, setJoining] = useState(false);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const [sure, setSure] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = `${WEB_URL}#familie=${store.code}`;
  const state = !DATABASE_URL ? 'Ikke sat op endnu' : !store.code ? 'Kun i denne browser'
    : { ONLINE: 'Forbundet – alt er delt', CONNECTING: 'Forbinder…', ERROR: 'Serveren afviste forbindelsen' }[store.sync] || 'Offline – ændringer sendes senere';
  const share = async () => {
    fx.tap();
    try {
      if (navigator.share) await navigator.share({ title: 'Pligter & Lommepenge', url: link });
      else { await navigator.clipboard.writeText(link); setCopied(true); }
    } catch { /* closed the share sheet */ }
  };
  let body;
  if (!DATABASE_URL) body = html`<div class="muted">Når den online database er sat op, kan I bruge appen på flere telefoner.</div>`;
  else if (!store.code && !joining) {
    body = html`<div class="muted">Del familien, så I kan bruge den på flere telefoner – både iPhone og Android.</div>
      <div class="row gap8">
        <button class="btn purple grow" onClick=${() => { fx.coin(); store.createOnline(); }}>Del online</button>
        <button class="btn purple outline grow" onClick=${() => { fx.tap(); setJoining(true); }}>Har en kode</button>
      </div>`;
  } else if (!store.code) {
    body = html`<div class="muted">Skriv koden fra den anden telefon. Data her bliver erstattet af familiens.</div>
      <input class=${`field ${bad ? 'bad' : ''}`} placeholder="Familiekode" value=${typed} autocapitalize="off"
        onInput=${(e) => { setTyped(e.target.value); setBad(false); }} />
      <div class="row gap8"><span class="grow"></span>
        <button class="btn grey outline" onClick=${() => setJoining(false)}>Annuller</button>
        <button class="btn purple" onClick=${() => { if (store.join(typed)) { fx.coin(); setJoining(false); } else setBad(true); }}>Forbind</button>
      </div>`;
  } else {
    body = html`<small class="muted">Familiekode</small>
      <div class="code">${prettyCode(store.code)}</div>
      <div class="muted">Åbn linket på den anden telefon. På iPhone: Del → <b>Føj til hjemmeskærm</b>. I Android-appen: skriv koden under Indstillinger.</div>
      <div class="row gap8">
        <button class="btn purple grow" onClick=${share}>${copied ? '✓ Kopieret' : 'Del link'}</button>
        <button class=${`btn red grow ${sure ? '' : 'outline'}`} onClick=${() => { if (sure) { store.leave(); setSure(false); } else setSure(true); }}>${sure ? 'Sikker?' : 'Stop deling'}</button>
      </div>`;
  }
  return html`<div class="card card-pad stack">
    <div class="row gap12"><span class="big-emoji">☁️</span><div class="grow"><b>Online deling</b><div class="muted">${state}</div></div>
      ${store.code && html`<i class=${`dot ${store.sync === 'ONLINE' ? 'ok' : store.sync === 'ERROR' ? 'err' : ''}`}></i>`}</div>
    ${body}
  </div>`;
}

function Modal({ title, close, children }) {
  return html`<div class="modal" onClick=${(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="sheet stack"><h3>${title}</h3>${children}</div>
  </div>`;
}

const EmojiGrid = ({ options, value, pick }) => html`<div class="emoji-grid">${options.map((e) => html`
  <button class=${e === value ? 'on' : ''} onClick=${() => pick(e)}>${e}</button>`)}</div>`;

const Pills = ({ options, value, pick }) => html`<div class="pills">${options.map(([v, label]) => html`
  <button class=${v === value ? 'on' : ''} onClick=${() => pick(v)}>${label}</button>`)}</div>`;

function ChoreEditor({ start, close }) {
  const [title, setTitle] = useState(start.title);
  const [emoji, setEmoji] = useState(start.emoji);
  const [reward, setReward] = useState(krText(start.reward));
  const [repeat, setRepeat] = useState(start.repeat);
  const [kids, setKids] = useState(start.kids);
  const [sure, setSure] = useState(false);
  const amount = parseKr(reward);
  const ok = title.trim() && amount !== null && amount >= 0;
  return html`<${Modal} title=${start.id ? 'Ret pligt' : 'Ny pligt'} close=${close}>
    <label>Hvad skal laves?<input class="field" value=${title} maxlength="40" onInput=${(e) => setTitle(e.target.value)} /></label>
    <label>Ikon</label><${EmojiGrid} options=${CHORE_EMOJIS} value=${emoji} pick=${setEmoji} />
    <label>Belønning (kr)<input class=${`field ${amount === null || amount < 0 ? 'bad' : ''}`} inputmode="decimal" value=${reward} onInput=${(e) => setReward(e.target.value)} /></label>
    <${Pills} options=${['1', '2', '5', '10', '20'].map((v) => [v, `${v} kr`])} value=${reward} pick=${setReward} />
    <label>Hvor tit?</label><${Pills} options=${Object.entries(REPEAT)} value=${repeat} pick=${setRepeat} />
    <label>Hvem?</label>
    <div class="pills">${store.family.kids.map((k) => html`<button class=${kids.includes(k.id) ? 'on' : ''}
      onClick=${() => setKids(kids.includes(k.id) ? kids.filter((x) => x !== k.id) : [...kids, k.id])}>${k.avatar} ${k.name}</button>`)}</div>
    <div class="row gap8">
      ${start.id && html`<button class=${`btn red ${sure ? '' : 'outline'}`} onClick=${() => { if (sure) { store.removeChore(start.id); close(); } else setSure(true); }}>${sure ? 'Sikker?' : 'Slet'}</button>`}
      <span class="grow"></span>
      <button class="btn grey outline" onClick=${close}>Annuller</button>
      <button class="btn purple" disabled=${!ok} onClick=${() => { store.saveChore({ id: start.id, title: title.trim(), emoji, reward: amount, repeat, kids }); close(); }}>Gem</button>
    </div>
  <//>`;
}

function KidEditor({ start, close }) {
  const [name, setName] = useState(start.name);
  const [avatar, setAvatar] = useState(start.avatar);
  const [color, setColor] = useState(start.color);
  const [weekly, setWeekly] = useState(krText(start.weekly));
  const [goalName, setGoalName] = useState(start.goalName);
  const [goalEmoji, setGoalEmoji] = useState(start.goalEmoji);
  const [goal, setGoal] = useState(start.goalAmount ? krText(start.goalAmount) : '');
  const [sleep, setSleep] = useState(start.sleep !== false);
  const [sure, setSure] = useState(false);
  const w = parseKr(weekly);
  const g = parseKr(goal);
  const ok = name.trim() && w !== null && w >= 0 && g !== null && g >= 0;
  return html`<${Modal} title=${start.id ? `Ret ${start.name}` : 'Nyt barn'} close=${close}>
    <div class="center"><div class="avatar xl" style=${{ background: grad(palette(color)) }}>${avatar}</div></div>
    <label>Navn<input class="field" value=${name} maxlength="20" onInput=${(e) => setName(e.target.value)} /></label>
    <label>Figur</label><${EmojiGrid} options=${AVATAR_EMOJIS} value=${avatar} pick=${setAvatar} />
    <label>Farve</label>
    <div class="swatches">${PALETTES.map((p, i) => html`<button class=${i === color ? 'on' : ''} style=${{ background: grad(p) }} onClick=${() => setColor(i)} aria-label=${`Farve ${i + 1}`}></button>`)}</div>
    <label>Ugepenge (kr hver mandag)<input class=${`field ${w === null ? 'bad' : ''}`} inputmode="decimal" value=${weekly} onInput=${(e) => setWeekly(e.target.value)} /></label>
    <label>Sparemål</label><${EmojiGrid} options=${GOAL_EMOJIS} value=${goalEmoji} pick=${setGoalEmoji} />
    <label>Hvad sparer ${name.trim() || 'barnet'} op til?<input class="field" value=${goalName} maxlength="30" onInput=${(e) => setGoalName(e.target.value)} /></label>
    <label>Koster (kr) – tom = intet mål<input class=${`field ${g === null ? 'bad' : ''}`} inputmode="decimal" value=${goal} onInput=${(e) => setGoal(e.target.value)} /></label>
    <div class="row gap12"><div class="grow"><b>🌙 Sove i egen seng</b><div class="muted">Stjerner og månedsbonus for nætter i egen seng</div></div>
      <${Toggle} on=${sleep} onChange=${setSleep} /></div>
    <div class="row gap8">
      ${start.id && html`<button class=${`btn red ${sure ? '' : 'outline'}`} onClick=${() => { if (sure) { store.removeKid(start.id); close(); } else setSure(true); }}>${sure ? 'Slet alt?' : 'Slet'}</button>`}
      <span class="grow"></span>
      <button class="btn grey outline" onClick=${close}>Annuller</button>
      <button class="btn purple" disabled=${!ok} onClick=${() => {
        store.saveKid({ ...start, name: name.trim(), avatar, color, weekly: w, goalName: goalName.trim(), goalEmoji, goalAmount: g, sleep });
        close();
      }}>Gem</button>
    </div>
  <//>`;
}

function MoneyDialog({ kid, plus, close }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const ore = parseKr(amount);
  const tooMuch = !plus && ore !== null && ore > kid.balance;
  const ok = ore !== null && ore > 0 && !tooMuch;
  return html`<${Modal} title=${plus ? `Bonus til ${kid.name}` : `Udbetal fra ${kid.name}s gris`} close=${close}>
    <div class="muted">${plus ? 'Ekstra penge for noget særligt – de lægges direkte i sparegrisen.' : `Når ${kid.name} bruger penge, trækker I dem ud her. Der er ${kr(kid.balance)} i grisen.`}</div>
    <label>Beløb i kr<input class=${`field ${ore === null || tooMuch ? 'bad' : ''}`} inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} /></label>
    ${tooMuch && html`<small class="minus">Der er kun ${kr(kid.balance)} i grisen</small>`}
    <${Pills} options=${['5', '10', '20', '50', '100'].map((v) => [v, `${v} kr`])} value=${amount} pick=${setAmount} />
    <label>${plus ? 'Hvorfor? (fx Hjalp mormor)' : 'Til hvad? (fx Slik)'}<input class="field" value=${note} maxlength="40" onInput=${(e) => setNote(e.target.value)} /></label>
    <div class="row gap8"><span class="grow"></span>
      <button class="btn grey outline" onClick=${close}>Annuller</button>
      <button class=${`btn ${plus ? 'green' : 'red'}`} disabled=${!ok} onClick=${() => {
        if (plus) { fx.coin(); store.credit(kid.id, ore, note.trim() || 'Bonus', '🎁'); } else { fx.tap(); store.credit(kid.id, -ore, note.trim() || 'Udbetalt', '🛍️'); }
        close();
      }}>${plus ? 'Giv bonus' : 'Udbetal'}</button>
    </div>
  <//>`;
}

// ---------- App ----------

function App() {
  useStore();
  const [screen, setScreen] = useState('home');
  useEffect(() => {
    const back = (e) => setScreen(e.state?.s || 'home');
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);
  const go = (s, replace = false) => {
    if (s === 'home') { if (history.state?.s) history.back(); setScreen('home'); return; }
    if (replace) history.replaceState({ s }, ''); else history.pushState({ s }, '');
    setScreen(s);
    scrollTo(0, 0);
  };
  let page;
  if (!store.started) page = html`<${Welcome} go=${go} />`;
  else if (screen.startsWith('kid:')) page = html`<${KidPage} id=${screen.slice(4)} go=${go} />`;
  else if (screen === 'pin') page = html`<${Pin} go=${go} />`;
  else if (screen === 'parent') page = html`<${Parent} go=${go} />`;
  else page = html`<${Home} go=${go} />`;
  return html`<div class="screen" key=${store.started ? screen : 'welcome'}>${page}</div>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
