(function(){
  if(typeof window==='undefined') return;
  const handlers={};
  let ws=null;

  function join(room){
    const url=(location.origin.replace(/^http/,'ws')+`/ws/2048?room=${encodeURIComponent(room||'')}`);
    ws=new WebSocket(url);
    ws.addEventListener('open',()=>{
      handlers.open?.();
    });
    ws.addEventListener('message',e=>{
      try{
        const msg=JSON.parse(e.data);
        handlers[msg.type]?.(msg);
      }catch(err){
        import('../../tools/reporters/console-signature.js').then(({ error }) => {
          error('2048', err);
        });
      }
    });
  }

  function send(type,data={}){
    if(ws&&ws.readyState===WebSocket.OPEN){
      ws.send(JSON.stringify({type,...data}));
    }
  }

  function on(type,cb){ handlers[type]=cb; }

  // UI helpers for lobby
  const joinBtn=document.getElementById('joinBtn');
  const readyBtn=document.getElementById('readyBtn');
  const roomInput=document.getElementById('roomInput');
  const lobbyStatus=document.getElementById('lobbyStatus');

  joinBtn?.addEventListener('click',()=>{
    const room=roomInput.value.trim()||Math.random().toString(36).slice(2,8);
    roomInput.value=room;
    join(room);
    lobbyStatus.textContent=`Room ${room}. Share this code and press Ready.`;
    joinBtn.disabled=true;
    readyBtn.style.display='';
  });

  readyBtn?.addEventListener('click',()=>{
    send('ready',{});
    readyBtn.disabled=true;
    lobbyStatus.textContent='Waiting for opponent…';
  });

  window.Net={join,send,on};
})();
