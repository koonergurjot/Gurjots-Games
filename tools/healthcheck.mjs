import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

async function exists(p){
  try{ await access(p); return true; }
  catch{ return false; }
}

async function checkGame(root, game){
  const result = { Game: game.id, Status: 'OK', Reason: '' };
  const indexPath = path.join(root, game.path);
  if (!(await exists(indexPath))){
    result.Status = 'Fail';
    result.Reason = 'missing index.html';
    return result;
  }
  const html = await readFile(indexPath, 'utf8');
  const dom = new JSDOM(html);
  const moduleScripts = [...dom.window.document.querySelectorAll('script[type="module"][src]')];
  if (moduleScripts.length){
    const mainSrc = moduleScripts[0].getAttribute('src');
    const mainPath = path.join(path.dirname(indexPath), mainSrc);
    if (!(await exists(mainPath))){
      result.Status = 'Fail';
      result.Reason = `missing ${mainSrc}`;
      return result;
    }
    try{
      const mod = await import(pathToFileURL(mainPath).href);
      if (typeof mod.init === 'function'){
        try{
          const env = new JSDOM('<!doctype html><html><body></body></html>');
          global.window = env.window;
          global.document = env.window.document;
          await mod.init();
        } catch(err){
          result.Status = 'Fail';
          result.Reason = `init(): ${err.message}`;
        } finally {
          delete global.window;
          delete global.document;
        }
      }
    } catch(err){
      result.Status = 'Fail';
      result.Reason = `import failed: ${err.message}`;
    }
  }
  return result;
}

async function main(){
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const data = JSON.parse(await readFile(path.join(root, 'games.json'), 'utf8'));
  const results = [];
  for (const game of data){
    results.push(await checkGame(root, game));
  }
  console.table(results.map(r => ({ Game: r.Game, Status: r.Status, Reason: r.Reason })));
}

main().catch(err => { console.error(err); process.exit(1); });

