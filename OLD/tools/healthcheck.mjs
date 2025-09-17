import { readFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

async function exists(p){
  try{ await access(p); return true; }
  catch{ return false; }
}

async function checkGame(root, game){
  const result = { id: game.id || game.slug || game.title || 'unknown', status: 'ok', reason: '' };
  const entryRel = typeof game.entry === 'string' ? game.entry.replace(/^\//, '') : null;
  const indexRel = typeof game.path === 'string' ? game.path.replace(/^\//, '') : null;
  const indexPath = indexRel
    ? path.join(root, indexRel)
    : entryRel
      ? path.join(root, path.dirname(entryRel), 'index.html')
      : null;
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
  const data = JSON.parse(await readFile(path.join(root, 'games.json'), 'utf8'));
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

