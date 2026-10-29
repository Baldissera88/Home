// A small stand-in for Firebase Realtime Database's REST API (GET, event streams, PATCH, PUT) plus a static file
// server for the web app, so the app and its sync can be tested without the real database.
//   node web/test/mock-rtdb.mjs [webPort=8080] [dbPort=9000]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webPort = +(process.argv[2] || 8080);
const dbPort = +(process.argv[3] || 9000);
let tree = {};
const streams = new Set();
let up = true;

const parts = (p) => p.split('/').filter(Boolean);
function get(p) {
  let n = tree;
  for (const k of parts(p)) { if (!n || typeof n !== 'object') return null; n = n[k]; }
  return n ?? null;
}
function set(p, v) {
  const ks = parts(p);
  if (!ks.length) { tree = v ?? {}; return; }
  let n = tree;
  for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
  if (v === null) delete n[ks.at(-1)]; else n[ks.at(-1)] = JSON.parse(JSON.stringify(v));
}

function notify(changed, event, data) {
  for (const s of streams) {
    if (!(changed + '/').startsWith(s.path + '/')) continue;
    const rel = '/' + changed.slice(s.path.length).replace(/^\/+/, '');
    s.res.write(`event: ${event}\ndata: ${JSON.stringify({ path: rel, data })}\n\n`);
  }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,PATCH,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-HTTP-Method-Override' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__down' || url.pathname === '/__up') {
    up = url.pathname === '/__up';
    if (!up) for (const s of streams) s.res.destroy();
    res.writeHead(200, cors).end('ok');
    return;
  }
  if (url.pathname === '/__tree') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(tree)); return; }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  if (!up) { req.socket.destroy(); return; }
  const p = url.pathname.replace(/\.json$/, '');
  const method = req.headers['x-http-method-override'] || req.method;
  if (method === 'GET' && (req.headers.accept || '').includes('text/event-stream')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: get(p) })}\n\n`);
    const s = { path: p.replace(/\/+$/, ''), res };
    streams.add(s);
    req.on('close', () => streams.delete(s));
    return;
  }
  if (method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(get(p))); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const v = JSON.parse(body || 'null');
    if (method === 'PUT') { set(p, v); notify(p, 'put', v); }
    else if (method === 'PATCH') { for (const [k, x] of Object.entries(v)) set(`${p}/${k}`, x); notify(p, 'patch', v); }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(v));
  });
}).listen(dbPort);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let f = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (f.endsWith('/')) f += 'index.html';
  if (f === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(`export const DATABASE_URL = 'http://localhost:${dbPort}';`);
    return;
  }
  const file = path.join(root, path.normalize(f));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(webPort, () => console.log(`web on http://localhost:${webPort}, db on http://localhost:${dbPort}`));
