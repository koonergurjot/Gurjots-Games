const BAG_ORDER=['I','O','T','S','Z','J','L'];

function normalizeSeed(seed){
  if(Number.isInteger(seed)) return seed>>>0;
  if(typeof seed==='string'){
    const trimmed=seed.trim();
    if(!trimmed) return null;
    const radix=trimmed.startsWith('0x')||trimmed.startsWith('0X')?16:10;
    const parsed=Number.parseInt(trimmed,radix);
    if(Number.isFinite(parsed)) return parsed>>>0;
  }
  return null;
}

function normalizeModeName(mode){
  if(typeof mode!=='string') return 'bag';
  const trimmed=mode.trim().toLowerCase();
  return trimmed||'bag';
}

function mulberry32(seed){
  let a=seed>>>0;
  return function(){
    a=(a+0x6D2B79F5)>>>0;
    let t=Math.imul(a^a>>>15,1|a);
    t=(t+Math.imul(t^t>>>7,61|t))^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

function createSeed(randomSource=(typeof crypto!=='undefined'?crypto:null)){
  if(randomSource && typeof randomSource.getRandomValues==='function'){
    const buf=new Uint32Array(1);
    randomSource.getRandomValues(buf);
    return buf[0]>>>0;
  }
  return Math.floor(Math.random()*0xffffffff)>>>0;
}

function createBag(seed=createSeed()){
  let currentSeed=(normalizeSeed(seed)??createSeed())>>>0;
  let rng=mulberry32(currentSeed);
  let bag=[];
  function refill(){
    bag=BAG_ORDER.slice();
    for(let i=bag.length-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [bag[i],bag[j]]=[bag[j],bag[i]];
    }
  }
  return {
    get seed(){ return currentSeed; },
    next(){
      if(bag.length===0) refill();
      return bag.pop();
    },
    reset(newSeed=createSeed()){
      const normalized=normalizeSeed(newSeed);
      currentSeed=(normalized??createSeed())>>>0;
      rng=mulberry32(currentSeed);
      bag.length=0;
      return currentSeed;
    },
    snapshot(){
      if(bag.length===0) refill();
      return bag.slice().reverse();
    },
  };
}

function createClassicRandomizer(seed=createSeed()){
  let currentSeed=(normalizeSeed(seed)??createSeed())>>>0;
  let rng=mulberry32(currentSeed);
  return {
    get seed(){ return currentSeed; },
    next(){
      const index=Math.floor(rng()*BAG_ORDER.length);
      return BAG_ORDER[index];
    },
    reset(newSeed=createSeed()){
      const normalized=normalizeSeed(newSeed);
      currentSeed=(normalized??createSeed())>>>0;
      rng=mulberry32(currentSeed);
      return currentSeed;
    },
    snapshot(){
      return [];
    },
  };
}

function createDoubleBagRandomizer(seed=createSeed()){
  let currentSeed=(normalizeSeed(seed)??createSeed())>>>0;
  let rng=mulberry32(currentSeed);
  let queue=[];
  let index=0;

  function shuffle(list){
    for(let i=list.length-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [list[i],list[j]]=[list[j],list[i]];
    }
    return list;
  }

  function refill(){
    const first=shuffle(BAG_ORDER.slice());
    const second=shuffle(BAG_ORDER.slice());
    queue=[...first,...second];
    index=0;
  }

  function ensureQueue(){
    if(index>=queue.length) refill();
  }

  return {
    get seed(){ return currentSeed; },
    next(){
      ensureQueue();
      return queue[index++];
    },
    reset(newSeed=createSeed()){
      const normalized=normalizeSeed(newSeed);
      currentSeed=(normalized??createSeed())>>>0;
      rng=mulberry32(currentSeed);
      queue.length=0;
      index=0;
      refill();
      return currentSeed;
    },
    snapshot(){
      ensureQueue();
      return queue.slice(index);
    },
  };
}

const DEFAULT_RANDOMIZER_MODES={
  bag:({ seed })=>createBag(seed),
  classic:({ seed })=>createClassicRandomizer(seed),
  double:({ seed })=>createDoubleBagRandomizer(seed),
};

function createRandomizer(mode='bag',seed=createSeed(),options={}){
  const factories=options?.modes||DEFAULT_RANDOMIZER_MODES;
  const normalizedMode=normalizeModeName(mode);
  const factory=factories?.[normalizedMode]||factories?.bag||DEFAULT_RANDOMIZER_MODES.bag;
  const normalizedSeed=normalizeSeed(seed);
  const initialSeed=(normalizedSeed??createSeed())>>>0;
  const internal=factory({ seed: initialSeed, createSeed, mulberry32, BAG_ORDER });
  if(!internal || typeof internal.next!=='function'){
    throw new Error(`Randomizer factory for mode "${normalizedMode}" must provide a next() method.`);
  }
  let currentSeed=Number.isInteger(internal.seed)?internal.seed>>>0:initialSeed;
  function readSeed(){
    if(Number.isInteger(internal.seed)) return internal.seed>>>0;
    if(typeof internal.seed==='function'){
      try{
        const value=internal.seed();
        if(Number.isInteger(value)) return value>>>0;
      }catch{}
    }
    return currentSeed>>>0;
  }
  function applyReset(newSeed=createSeed()){
    const normalized=normalizeSeed(newSeed);
    const resolved=(normalized??createSeed())>>>0;
    if(typeof internal.reset==='function'){
      const result=internal.reset(resolved);
      currentSeed=Number.isInteger(result)?result>>>0:resolved;
    }else{
      currentSeed=resolved;
    }
    return currentSeed>>>0;
  }
  currentSeed=applyReset(initialSeed);
  return {
    mode: normalizedMode,
    get seed(){ return readSeed(); },
    next(){ return internal.next(); },
    reset: applyReset,
    snapshot: typeof internal.snapshot==='function'?()=>internal.snapshot():()=>[],
  };
}

function createRandomizerSelector({ mode='bag', seed=createSeed(), modes=DEFAULT_RANDOMIZER_MODES }={}){
  const factories=modes||DEFAULT_RANDOMIZER_MODES;
  let currentMode=normalizeModeName(mode);
  let currentSeed=(normalizeSeed(seed)??createSeed())>>>0;
  let randomizer=createRandomizer(currentMode,currentSeed,{ modes: factories });

  function syncSeed(){
    currentSeed=randomizer.seed>>>0;
    return currentSeed;
  }

  function next(){
    return randomizer.next();
  }

  function reset(newSeed=createSeed()){
    const normalized=normalizeSeed(newSeed);
    currentSeed=randomizer.reset((normalized??createSeed())>>>0);
    return currentSeed;
  }

  function setMode(nextMode,seedOverride){
    currentMode=normalizeModeName(nextMode);
    const normalizedSeed=normalizeSeed(seedOverride);
    const baseSeed=(normalizedSeed??syncSeed())>>>0;
    randomizer=createRandomizer(currentMode,baseSeed,{ modes: factories });
    syncSeed();
    return currentMode;
  }

  return {
    get mode(){ return currentMode; },
    get seed(){ return syncSeed(); },
    get modes(){ return Object.keys(factories); },
    next,
    reset,
    snapshot(){
      const snap=randomizer.snapshot();
      return Array.isArray(snap)?snap.slice():[];
    },
    setMode,
    generate(count=14,seedValue,modeOverride){
      const safeCount=Math.max(0,Math.min(100000,Number.isFinite(count)?Math.floor(count):0));
      const normalizedSeed=normalizeSeed(seedValue);
      const targetSeed=typeof normalizedSeed==='number'?normalizedSeed:syncSeed();
      const normalizedMode=modeOverride?normalizeModeName(modeOverride):currentMode;
      return generateSequence(targetSeed,safeCount,normalizedMode,{ modes: factories });
    },
  };
}

function generateSequence(seed,count,modeOrOptions='bag',maybeOptions){
  const safeCount=Math.max(0,Math.min(100000,Number.isFinite(count)?Math.floor(count):0));
  let mode='bag';
  let options={};
  if(typeof modeOrOptions==='string' || typeof modeOrOptions==='number'){
    mode=normalizeModeName(String(modeOrOptions));
    if(maybeOptions && typeof maybeOptions==='object') options=maybeOptions;
  }else if(modeOrOptions && typeof modeOrOptions==='object'){
    options=modeOrOptions;
  }
  const normalizedSeed=normalizeSeed(seed);
  const resolvedSeed=(normalizedSeed??createSeed())>>>0;
  const randomizer=createRandomizer(mode,resolvedSeed,options);
  const out=new Array(safeCount);
  for(let i=0;i<safeCount;i++) out[i]=randomizer.next();
  return out;
}

export {
  BAG_ORDER,
  createBag,
  createSeed,
  createRandomizer,
  createRandomizerSelector,
  generateSequence,
  mulberry32,
  DEFAULT_RANDOMIZER_MODES,
};
