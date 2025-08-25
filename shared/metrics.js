
// Client-side metrics: session timing & daily aggregations
// keys: plays:<slug>, time:<slug> (ms), dayplays:YYYY-MM-DD
function today(){ return new Date().toISOString().slice(0,10); }

let session = null;

export function startSessionTimer(slug){
  endSessionTimer(slug); // end any prior without losing data
  session = { slug, start: performance.now() };
}

export function endSessionTimer(slug){
  if (!session || session.slug !== slug) return;
  const ms = performance.now() - session.start;
  const key = `time:${slug}`;
  const prev = Number(localStorage.getItem(key) || 0);
  localStorage.setItem(key, String(prev + Math.round(ms)));

  // daily plays aggregation
  const dkey = `dayplays:${today()}`;
  const dprev = Number(localStorage.getItem(dkey) || 0);
  localStorage.setItem(dkey, String(dprev + 1));
  session = null;
}

export function getTimeByGame(){
  const rows = [];
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('time:')) {
      const slug = k.split(':')[1];
      rows.push({ slug, ms: Number(localStorage.getItem(k)||0) });
    }
  }
  return rows.sort((a,b)=> b.ms - a.ms);
}

export function getPlaysByDay(limit=14){
  const rows = [];
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('dayplays:')) {
      rows.push({ day: k.split(':')[1], count: Number(localStorage.getItem(k)||0) });
    }
  }
  rows.sort((a,b)=> a.day.localeCompare(b.day));
  return rows.slice(-limit);
}
