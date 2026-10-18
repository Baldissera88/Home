// Solver for Sticky Paws rooms: Dijkstra over (grid cell, pressed buttons, collected stars).
// Uses the game's own hit rules (see index.html: blockedAt, onPoint, chase) with a small safety margin,
// so a route it finds is one a player's finger can follow.
export const W = 360, H = 640, AR = 8, O = { x: 84, y: 576 };
export const COLORS = ['a', 'b', 'c'];
const G = 8, NX = 45, NY = 80, M = 4; // grid pitch, size, safety margin

function psd(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((x - x1) * dx + (y - y1) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function inRect(x, y, w, r) {
  const cx = Math.max(w[0], Math.min(x, w[0] + w[2])), cy = Math.max(w[1], Math.min(y, w[1] + w[3]));
  return Math.hypot(x - cx, y - cy) < r;
}

/** Returns {l1, l3, path} — shortest arm length to grab the toy, to grab it with both stars
 *  (Infinity if impossible), and with opts.path the 3-star route as [x, y] points. */
export function solve(lv, opts = {}) {
  const cells = NX * NY, nb = 3, coins = lv.coins || [];
  const px = i => 4 + G * (i % NX), py = i => 4 + G * Math.floor(i / NX);
  // Static blocking (walls, edges) and per-colour-mask hazard tables.
  const blocked = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    const x = px(i), y = py(i);
    if (x < AR + 2 || x > W - AR - 2 || y < AR + 2 || y > H - AR - 2) blocked[i] = 1;
    else for (const w of lv.walls) if (inRect(x, y, w, AR + 3)) { blocked[i] = 1; break; }
  }
  const bit = c => 1 << COLORS.indexOf(c);
  const hazard = [];
  for (let m = 0; m < 8; m++) {
    const h = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      if (blocked[i]) continue;
      const x = px(i), y = py(i);
      for (const l of lv.lasers) if (!(l[4] && (m & bit(l[4]))) && psd(x, y, l[0], l[1], l[2], l[3]) < AR + 2 + M) { h[i] = 1; break; }
      if (h[i]) continue;
      for (const d of lv.dogs) if (Math.hypot(x - d[0], y - d[1]) < d[2] + AR - 4 + M) { h[i] = 1; break; }
      if (h[i]) continue;
      for (const b of lv.bots) if (!(b[6] && (m & bit(b[6]))) && psd(x, y, b[0], b[1], b[2], b[3]) < b[4] + AR + M) { h[i] = 1; break; }
    }
    hazard.push(h);
  }
  const btnAt = new Uint8Array(cells), coinAt = new Uint8Array(cells), tgt = new Uint8Array(cells), grabZone = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    const x = px(i), y = py(i);
    if (!opts.noButtons) for (const b of lv.buttons) if (Math.hypot(x - b[0], y - b[1]) < 10) btnAt[i] |= bit(b[2]);
    coins.forEach((c, k) => { if (Math.hypot(x - c[0], y - c[1]) < 10) coinAt[i] |= 1 << k; });
    if (Math.hypot(x - lv.target[0], y - lv.target[1]) < 20) tgt[i] = 1;
    // The game grabs the toy within 26px, so near it a route may only close in, never brush past to a star.
    if (Math.hypot(x - lv.target[0], y - lv.target[1]) < 34) grabZone[i] = 1;
  }
  const tdist = i => Math.hypot(px(i) - lv.target[0], py(i) - lv.target[1]);
  const S = 32, dist = new Float64Array(cells * S).fill(Infinity), prev = new Int32Array(cells * S).fill(-1);
  const heap = []; // [d, state]
  const push = (d, s) => { heap.push([d, s]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const start = Math.round((O.y - 4) / G) * NX + Math.round((O.x - 4) / G);
  const s0 = (btnAt[start] | (coinAt[start] << 3));
  if (blocked[start] || hazard[s0 & 7][start]) return { l1: Infinity, l3: Infinity };
  dist[start * S + s0] = 0; push(0, start * S + s0);
  const full = (1 << coins.length) - 1;
  let l1 = Infinity, l3 = Infinity, end = -1;
  const NB = [[1, 0, 8], [-1, 0, 8], [0, 1, 8], [0, -1, 8], [1, 1, 11.31], [1, -1, 11.31], [-1, 1, 11.31], [-1, -1, 11.31]];
  while (heap.length) {
    const [d, s] = pop(); if (d > dist[s]) continue;
    const i = Math.floor(s / S), m = s % S;
    if (tgt[i]) { if (d < l1) l1 = d; if ((m >> 3) === full) { l3 = d; end = s; break; } continue; }
    const x = i % NX, y = Math.floor(i / NX);
    for (const [dx, dy, c] of NB) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
      const j = ny * NX + nx; if (blocked[j]) continue;
      if (grabZone[i] && tdist(j) >= tdist(i)) continue;
      if (dx && dy && (blocked[y * NX + nx] || blocked[ny * NX + x])) continue;
      const nm = m | btnAt[j] | (coinAt[j] << 3);
      if (hazard[nm & 7][j]) continue;
      if (dx && dy && (hazard[nm & 7][y * NX + nx] || hazard[nm & 7][ny * NX + x])) continue;
      const ns = j * S + nm, nd = d + c;
      if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = s; push(nd, ns); }
    }
  }
  const path = [];
  if (opts.path) for (let s = end; s >= 0; s = prev[s]) { const i = Math.floor(s / S); path.unshift([px(i), py(i)]); }
  return { l1, l3, path };
}
