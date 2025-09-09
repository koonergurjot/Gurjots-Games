
// Client-side metrics: session timing & daily aggregations
// keys: plays:<slug>, time:<slug> (ms), dayplays:YYYY-MM-DD
function today(){ return new Date().toISOString().slice(0,10); }

let session = null;

export function startSessionTimer(slug){
  endSessionTimer(session?.slug); // end any prior without losing data
  session = { slug, start: performance.now() };
}

export function endSessionTimer(slug){
  if (!session) return;
  // Allow ending the current session without explicitly passing the slug.
  if (slug && session.slug !== slug) return;

  const ms = performance.now() - session.start;
  const key = `time:${session.slug}`;
  // guard against invalid stored values (e.g. "NaN")
  const prevRaw = Number(localStorage.getItem(key));
  const prev = Number.isFinite(prevRaw) ? prevRaw : 0;
  localStorage.setItem(key, String(prev + Math.round(ms)));

  // daily plays aggregation
  const dkey = `dayplays:${today()}`;
  const dprevRaw = Number(localStorage.getItem(dkey));
  const dprev = Number.isFinite(dprevRaw) ? dprevRaw : 0;
  localStorage.setItem(dkey, String(dprev + 1));
  session = null;
}

export function getTimeByGame(){
  const rows = [];
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('time:')) {
      const slug = k.split(':')[1];
      const msRaw = Number(localStorage.getItem(k));
      const ms = Number.isFinite(msRaw) ? msRaw : 0;
      rows.push({ slug, ms });
    }
  }
  return rows.sort((a,b)=> b.ms - a.ms);
}

export function getPlaysByDay(limit=14){
  const rows = [];
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('dayplays:')) {
      const countRaw = Number(localStorage.getItem(k));
      const count = Number.isFinite(countRaw) ? countRaw : 0;
      rows.push({ day: k.split(':')[1], count });
    }
  }
  rows.sort((a,b)=> a.day.localeCompare(b.day));
  return rows.slice(-limit);
}
