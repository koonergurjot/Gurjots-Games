(function(){
  let ctx;
  function ensure(){ if(!ctx) ctx = new (window.AudioContext||window.webkitAudioContext)(); return ctx; }
  function beep({freq=440, dur=0.08, type='sine', vol=0.2}={}){
    const ac = ensure();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(ac.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.stop(ac.currentTime + dur + 0.02);
  }
  function seq(list){
    const ac = ensure(); let t = ac.currentTime;
    list.forEach(([f,d=0.06,v=0.2])=>{
      const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(ac.destination);
      o.start(t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.stop(t + d + 0.02); t += d*0.9;
    });
  }
  window.SFX = { beep, seq };
})();