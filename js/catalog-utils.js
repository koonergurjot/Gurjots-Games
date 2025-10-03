export function normalizeTimestamp(value){
  if(value==null)return 0;
  if(value instanceof Date){
    const t=value.getTime();
    return Number.isNaN(t)?0:t;
  }
  if(typeof value==='number'){
    if(!Number.isFinite(value))return 0;
    if(Math.abs(value)>=1e12)return value;
    if(Math.abs(value)>=1e9)return value*1000;
    if(Math.abs(value)>=1e6)return value*1000;
    return 0;
  }
  if(typeof value==='string'){
    const trimmed=value.trim();
    if(!trimmed)return 0;
    const asNumber=Number(trimmed);
    if(Number.isFinite(asNumber))return normalizeTimestamp(asNumber);
    const parsed=Date.parse(trimmed);
    return Number.isNaN(parsed)?0:parsed;
  }
  return 0;
}

export function deriveComparableTimestamp(game){
  if(!game||typeof game!=='object')return 0;
  const candidates=[
    game.addedAt,
    game.added_at,
    game.released,
    game.releaseDate,
    game.release_date,
    game.publishedAt,
    game.published_at,
    game.updatedAt,
    game.updated_at,
    game.createdAt,
    game.created_at,
    game.date
  ];
  for(const value of candidates){
    const stamp=normalizeTimestamp(value);
    if(stamp)return stamp;
  }
  return 0;
}

export function adaptGameForLanding(raw){
  if(!raw)return null;
  const description=raw.description||raw.short||raw.desc||'';
  const tags=Array.isArray(raw.tags)?raw.tags.filter(Boolean):[];
  let path=raw.playPath||raw.path||raw.playUrl||raw.url||null;
  if(!path&&raw.basePath){
    const base=String(raw.basePath).replace(/\/+$/,'');
    path=base&&base!=='/'?`${base}/index.html`:'/index.html';
  }
  const comparableTimestamp=deriveComparableTimestamp(raw);
  return{
    ...raw,
    description,
    desc:description,
    tags,
    path,
    comparableTimestamp
  };
}
