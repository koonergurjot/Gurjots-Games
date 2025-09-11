const channel = new BroadcastChannel('shooter');

const listeners = new Map();

channel.addEventListener('message', e => {
  const { type, data } = e.data || {};
  const fns = listeners.get(type);
  if (fns) fns.forEach(fn => fn(data));
});

function on(type, fn){
  if(!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}

function syncPlayer(player){
  channel.postMessage({ type: 'player', data: player });
}

function syncEnemies(enemies){
  channel.postMessage({ type: 'enemies', data: enemies });
}

function syncDefenses(defenses){
  channel.postMessage({ type: 'defenses', data: defenses });
}

export default { on, syncPlayer, syncEnemies, syncDefenses };
