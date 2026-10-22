import { Engine } from './engine.js';

// Entry point inside the game's WebView. The game posts the level and a frame per display frame;
// the page answers through the `Android` bridge when it is ready or when something breaks.
const params = new URLSearchParams(location.search);
const bridge = window.Android || null;
const engine = new Engine({ quality: params.get('q') || 'high', bridge });
window.engine = engine;
window.wire = (m) => engine.receive(m);
// Scene3D hands over one end of a WebMessageChannel ("port"); frames then arrive on it instead of the window.
addEventListener('message', (e) => {
  if (e.data === 'port' && e.ports && e.ports[0]) {
    e.ports[0].onmessage = (ev) => engine.receive(ev.data);
    return;
  }
  engine.receive(e.data);
});
addEventListener('error', (e) => engine.report(`${e.message} @${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => engine.report('rejection: ' + (e.reason && e.reason.stack || e.reason)));

engine.init()
  .then(() => {
    engine.start();
    if (bridge && bridge.ready) bridge.ready();
  })
  .catch((e) => engine.report('init failed: ' + (e && e.stack || e)));
