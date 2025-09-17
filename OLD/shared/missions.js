// Mission system with simple persistent storage

const MISSIONS = {
  runner: [
    {
      id: 'collect_50_coins',
      description: 'Collect 50 coins',
      type: 'coins',
      goal: 50,
      xp: 50,
      score: 500
    },
    {
      id: 'survive_60s',
      description: 'Survive 60 seconds',
      type: 'time',
      goal: 60,
      xp: 75,
      score: 750
    }
  ]
};

function profileId(){
  return localStorage.getItem('profile') || 'default';
}

function missionKey(slug){
  return `mission:${profileId()}:${slug}`;
}

function xpKey(){
  return `profile:xp:${profileId()}`;
}

export function getXP(){
  const parsed = Number(localStorage.getItem(xpKey()));
  return Number.isFinite(parsed) ? parsed : 0;
}

function addXP(n){
  const k = xpKey();
  const prev = getXP();
  const next = prev + n;
  if (Number.isFinite(next)){
    localStorage.setItem(k, String(next));
  }
}

function saveMission(slug, obj){
  localStorage.setItem(missionKey(slug), JSON.stringify(obj));
}

export function getMission(slug){
  try {
    const stored = JSON.parse(localStorage.getItem(missionKey(slug)) || 'null');
    if (stored) return stored;
  } catch {}
  const pool = MISSIONS[slug] || [];
  if (pool.length === 0) return null;
  const m = { ...pool[Math.floor(Math.random()*pool.length)], progress: 0, completed: false };
  saveMission(slug, m);
  return m;
}

export function updateMission(slug, inc){
  const m = getMission(slug);
  if (!m || m.completed) return m;
  const val = inc[m.type];
  if (val){
    m.progress += val;
    if (m.progress >= m.goal){
      m.progress = m.goal;
      m.completed = true;
      addXP(m.xp);
    }
    saveMission(slug, m);
  }
  return m;
}

export function clearMission(slug){
  localStorage.removeItem(missionKey(slug));
}

export function formatMission(m){
  if (!m) return '';
  if (m.completed) return `${m.description} ✔`;
  const prog = m.type === 'time' ? Math.floor(m.progress) : m.progress;
  return `${m.description}: ${prog}/${m.goal}`;
}

export default { getMission, updateMission, clearMission, formatMission, getXP };

