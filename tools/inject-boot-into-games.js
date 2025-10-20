import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const GAMES = path.join(ROOT, 'games');
const TAG = '<script src="../../shared/boot.js"></script>';

function injectBoot(html) {
  if (html.includes('shared/boot.js')) return html;
  return html.replace(/<script[^>]+src=/i, TAG + '\n$&');
}

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    const p = path.join(dir, item);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walk(p);
    else if (item === 'index.html' && p.includes(path.sep + 'games' + path.sep)) {
      const src = fs.readFileSync(p, 'utf8');
      const out = injectBoot(src);
      if (src !== out) {
        fs.writeFileSync(p, out);
        console.log('Injected boot.js into', p);
      }
    }
  }
}
walk(GAMES);
