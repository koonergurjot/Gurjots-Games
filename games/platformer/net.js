const channel = new BroadcastChannel('platformer-coop');
const myId = Math.random().toString(36).slice(2);
let peerId = null;
let connected = false;
const handlers = {};

export function connect(){
  channel.postMessage({ type: 'hello', id: myId });
}

channel.onmessage = e => {
  const msg = e.data;
  if (msg?.id === myId) return;

  if (msg.type === 'hello') {
    if (!connected) {
      peerId = msg.id;
      connected = true;
      channel.postMessage({ type: 'hello', id: myId });
      handlers.connect && handlers.connect();
    }
  } else if (handlers[msg.type]) {
    handlers[msg.type](msg.data);
  }
};

export function on(type, fn){
  handlers[type] = fn;
}

export function sendState(data){
  if (connected) channel.postMessage({ type: 'state', data });
}
export function sendCollect(data){
  if (connected) channel.postMessage({ type: 'collect', data });
}
export function sendEnemy(data){
  if (connected) channel.postMessage({ type: 'enemy', data });
}
export function sendAssist(){
  if (connected) channel.postMessage({ type: 'assist' });
}

export function isConnected(){
  return connected;
}

export function amHost(){
  if (!connected) return true;
  return myId < peerId;
}
