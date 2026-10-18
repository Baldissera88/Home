import { solve } from './solver.mjs';
import fs from 'fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const src = html.slice(html.indexOf('const L=o=>'), html.indexOf('const FIDGETS'));
const LEVELS = new Function('window', src + ';return LEVELS')({});
LEVELS.forEach((lv, i) => {
  const r = solve(lv), nb = lv.buttons.length ? solve(lv, { noButtons: true }).l1 : null;
  console.log(i + 1, lv.name.padEnd(18), 'max', lv.max, 'l1', Math.round(r.l1), 'l3', Math.round(r.l3), nb === null ? '' : 'noBtn ' + Math.round(nb));
});
