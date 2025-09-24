import { readFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

async function exists(p){
  try{ await access(p); return true; }
  catch{ return false; }
}

function cleanPath(p){
  return p.replace(/^\//, '').split('?')[0].split('#')[0];
}

function normalizePlayUrl(url){
  try{
    const parsed = new URL(url, 'https://example.com');
    const pathname = parsed.pathname.replace(/^\//, '');
    if (!pathname){
      return null;
    }
    if (pathname.endsWith('/')){
      return path.join(pathname, 'index.html');
    }
    if (pathname.endsWith('.html')){
      return pathname;
    }
    return path.join(pathname, 'index.html');
  }
  catch{
    if (typeof url === 'string' && url.trim()){
      const cleaned = cleanPath(url.trim());
      if (!cleaned){
        return null;
      }
      if (cleaned.endsWith('/')){
        return path.join(cleaned, 'index.html');
      }
      if (cleaned.endsWith('.html')){
        return cleaned;
      }
      return path.join(cleaned, 'index.html');
    }
    return null;
  }
}

async function checkGame(root, game){
  const result = { id: game.id || game.slug || game.title || 'unknown', status: 'ok', reason: '' };
  const entryRel = typeof game.entry === 'string' ? cleanPath(game.entry) : null;
  const pathRel = typeof game.path === 'string' ? cleanPath(game.path) : null;
  const playRel = typeof game.playUrl === 'string' ? normalizePlayUrl(game.playUrl) : null;
  const slugRel = typeof game.slug === 'string' ? path.join('games', game.slug, 'index.html') : null;
  const fallbackRel = typeof game.id === 'string' ? path.join('games', game.id, 'index.html') : null;

  const indexRel = pathRel
    || playRel
    || (entryRel ? path.join(path.dirname(entryRel), 'index.html') : null)
    || slugRel
    || fallbackRel;
  const indexPath = indexRel ? path.join(root, indexRel) : null;
  if (!indexPath){
    result.status = 'fail';
    result.reason = 'missing path info';
    return result;
  }
  if (!(await exists(indexPath))){
    result.status = 'fail';
    result.reason = 'missing index.html';
    return result;
  }
  const html = await readFile(indexPath, 'utf8');
  const dom = new JSDOM(html);
  const moduleScripts = [...dom.window.document.querySelectorAll('script[type="module"][src]')];
  if (moduleScripts.length){
    const mainSrc = moduleScripts[0].getAttribute('src');
    const normalizedSrc = mainSrc?.split('?')[0]?.split('#')[0] || '';
    const mainPath = normalizedSrc.startsWith('/')
      ? path.join(root, normalizedSrc.replace(/^\//, ''))
      : path.join(path.dirname(indexPath), normalizedSrc);
    if (!(await exists(mainPath))){
      result.status = 'fail';
      result.reason = `missing ${mainSrc}`;
      return result;
    }
  }
  return result;
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export async function runHealthcheck(){
  const raw = JSON.parse(await readFile(path.join(root, 'games.json'), 'utf8'));
  const data = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.games)
      ? raw.games
      : typeof raw === 'object' && raw
        ? Object.keys(raw).map(key => ({ id: key, ...raw[key] }))
        : [];
  const results = [];
  for (const game of data){
    results.push(await checkGame(root, game));
  }
  return results;
}

async function main(){
  const results = await runHealthcheck();
  await writeFile(path.join(root, 'healthcheck.json'), JSON.stringify(results, null, 2));
  console.table(results.map(r => ({ Game: r.id, Status: r.status, Reason: r.reason })));
  return results.every(r => r.status === 'ok');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(ok => process.exit(ok ? 0 : 1)).catch(err => { console.error(err); process.exit(1); });
}

