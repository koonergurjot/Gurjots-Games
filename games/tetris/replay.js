(function(){
  let recording=false;
  let startTime=0;
  let data={pieces:[],actions:[]};
  let player=null;

  function reset(){
    data={pieces:[],actions:[]};
    startTime=0;
  }

  function start(){
    reset();
    recording=true;
    startTime=performance.now();
  }

  function stop(){
    recording=false;
    return data;
  }

  function recordPiece(t){
    if(recording) data.pieces.push(t);
  }

  function recordAction(a){
    if(recording) data.actions.push({t:performance.now()-startTime,a});
  }

  function exportData(){
    return JSON.stringify(data);
  }

  function download(name='tetris-replay.json'){
    if(typeof document==='undefined') return;
    const blob=new Blob([exportData()],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  class Player{
    constructor(d){
      this.pieces=d.pieces||[];
      this.actions=d.actions||[];
      this.t=0;
      this.ai=0;
      this.pi=0;
    }
    nextPiece(){
      return this.pieces[this.pi++];
    }
    tick(dt){
      if(Number.isFinite(dt)) this.t+=dt*1000;
      const ev=[];
      while(this.ai<this.actions.length && this.actions[this.ai].t<=this.t){
        ev.push(this.actions[this.ai++].a);
      }
      return ev;
    }
  }

  async function load(url){
    const res=await fetch(url);
    if(!res.ok){
      throw new Error(`Replay.load: request failed with status ${res.status} ${res.statusText||''}`.trim());
    }
    let d;
    try{
      d=await res.json();
    }catch(err){
      const message=err&&typeof err.message==='string'?err.message:String(err);
      const parseError=new Error(`Replay.load: failed to parse replay JSON: ${message}`);
      parseError.cause=err;
      throw parseError;
    }
    player=new Player(d);
    return player;
  }

  function nextPiece(){
    return player?.nextPiece();
  }

  function tick(dt){
    return player?player.tick(dt):[];
  }

  window.Replay={start,stop,recordPiece,recordAction,exportData,download,load,nextPiece,tick,Player};
})();
