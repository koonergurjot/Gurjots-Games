// Daily puzzle bootstrapper. Loads puzzles.json and exposes today's queue on window.puzzles.
(function(){
  const DAILY_PUZZLE_EVENT='chess:puzzles-state';
  const CACHE_BUST=`v=${Date.now().toString(36)}`;
  const PUZZLE_URL=`puzzles.json?${CACHE_BUST}`;

  const state={ status:'loading', puzzles:[], dateKey:null, error:null };
  window.puzzles = [];
  window.chessDailyPuzzlesState = state;

  function emit(){
    if(typeof window==='undefined'||typeof window.dispatchEvent!=='function') return;
    const detail={ status:state.status, puzzles:state.puzzles.slice(), dateKey:state.dateKey, error:state.error };
    let ev=null;
    if(typeof window.CustomEvent==='function'){
      ev=new window.CustomEvent(DAILY_PUZZLE_EVENT,{ detail });
    }else if(typeof document!=='undefined' && typeof document.createEvent==='function'){
      ev=document.createEvent('CustomEvent');
      ev.initCustomEvent(DAILY_PUZZLE_EVENT,false,false,detail);
    }
    if(ev) window.dispatchEvent(ev);
  }

  function pickDateKey(data){
    if(!data||typeof data!=='object') return null;
    const today=new Date();
    const iso=today.toISOString().slice(0,10);
    if(Array.isArray(data[iso]) && data[iso].length) return iso;
    if(Array.isArray(data.default) && data.default.length) return 'default';
    const keys=Object.keys(data).filter(k=>Array.isArray(data[k])&&data[k].length);
    if(!keys.length) return null;
    keys.sort();
    return keys[keys.length-1];
  }

  function normalizePuzzle(entry, index){
    if(!entry||typeof entry!=='object') return null;
    const fen=typeof entry.fen==='string'?entry.fen.trim():'';
    const solution=Array.isArray(entry.solution)?entry.solution.map(String).filter(Boolean):[];
    if(!fen||!solution.length) return null;
    return {
      fen,
      solution,
      title: typeof entry.title==='string'?entry.title:`Puzzle ${index+1}`,
      hint: typeof entry.hint==='string'?entry.hint:'',
      goal: typeof entry.goal==='string'?entry.goal:'Solve the tactic.',
      pgn: typeof entry.pgn==='string'?entry.pgn:'',
    };
  }

  async function load(){
    state.status='loading';
    state.puzzles=[];
    state.error=null;
    emit();
    try{
      const res=await fetch(PUZZLE_URL,{ cache:'no-store' });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      const key=pickDateKey(data);
      const rawList=(key&&Array.isArray(data[key]))?data[key]:[];
      const puzzles=[];
      rawList.forEach((entry,idx)=>{
        const normalized=normalizePuzzle(entry, idx);
        if(normalized) puzzles.push(normalized);
      });
      state.status=puzzles.length?'ready':'error';
      state.puzzles=puzzles.slice(0,10);
      state.dateKey=key;
      state.error=puzzles.length?null:new Error('No puzzles available');
      window.puzzles=state.puzzles.slice();
    }catch(err){
      state.status='error';
      state.error=err;
      state.puzzles=[];
      state.dateKey=null;
      window.puzzles=[];
    }
    emit();
  }

  if(typeof window!=='undefined'){
    window.reloadChessPuzzles=()=>{ load(); };
  }

  load();
})();
