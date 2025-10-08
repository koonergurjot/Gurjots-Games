const BAG_ORDER=['I','O','T','S','Z','J','L'];

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
  let currentSeed=seed>>>0;
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
      currentSeed=newSeed>>>0;
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

function generateSequence(seed,count){
  const bag=createBag(seed);
  const out=[];
  for(let i=0;i<count;i++) out.push(bag.next());
  return out;
}

export { BAG_ORDER, createBag, createSeed, generateSequence, mulberry32 };
