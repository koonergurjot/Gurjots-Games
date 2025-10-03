import { pushEvent } from '/games/common/diag-adapter.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
const CHANNEL_NAME = 'platformer-coop';

function createStubChannel() {
  let onMessageHandler = null;
  return {
    postMessage() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
    get onmessage() {
      return onMessageHandler;
    },
    set onmessage(handler) {
      onMessageHandler = typeof handler === 'function' ? handler : null;
    },
  };
}

let warningEmitted = false;
function warnCoopDisabled(reason) {
  if (warningEmitted) return;
  warningEmitted = true;
  const detailMessage = reason instanceof Error
    ? reason.message || reason.name || 'BroadcastChannel unavailable'
    : (typeof reason === 'string' && reason) || 'BroadcastChannel unavailable';
  const message = `[platformer] co-op disabled: ${detailMessage}`;

  try {
    if (globalScope?.console?.warn) {
      if (reason instanceof Error) {
        globalScope.console.warn(message, reason);
      } else {
        globalScope.console.warn(message);
      }
    }
  } catch (_err) {
    // Ignore console errors – diagnostics capture will still record the issue.
  }

  const payload = { level: 'warn', message };
  if (reason instanceof Error) {
    payload.detail = {
      name: reason.name || 'Error',
      message: reason.message || String(reason),
    };
  } else if (reason) {
    payload.detail = { reason: typeof reason === 'string' ? reason : String(reason) };
  }
  pushEvent('network', payload);
}

const BroadcastChannelCtor = globalScope && typeof globalScope.BroadcastChannel === 'function'
  ? globalScope.BroadcastChannel
  : undefined;

let realChannel = null;
let fallbackReason = null;

if (BroadcastChannelCtor) {
  try {
    realChannel = new BroadcastChannelCtor(CHANNEL_NAME);
  } catch (err) {
    fallbackReason = err instanceof Error ? err : new Error(String(err));
  }
} else if (globalScope) {
  fallbackReason = 'BroadcastChannel unsupported';
} else {
  fallbackReason = 'Window scope unavailable';
}

const channel = realChannel || createStubChannel();
const coopAvailable = !!realChannel;

if (!coopAvailable) {
  warnCoopDisabled(fallbackReason);
}

const myId = Math.random().toString(36).slice(2);
let peerId = null;
let connected = false;
const handlers = {};

export function connect(){
  if (!coopAvailable) return;
  channel.postMessage({ type: 'hello', id: myId });
}

channel.onmessage = e => {
  if (!coopAvailable) return;
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
  if (!coopAvailable || !connected) return;
  channel.postMessage({ type: 'state', data });
}
export function sendCollect(data){
  if (!coopAvailable || !connected) return;
  channel.postMessage({ type: 'collect', data });
}
export function sendEnemy(data){
  if (!coopAvailable || !connected) return;
  channel.postMessage({ type: 'enemy', data });
}
export function sendAssist(){
  if (!coopAvailable || !connected) return;
  channel.postMessage({ type: 'assist' });
}

export function isConnected(){
  return connected;
}

export function amHost(){
  if (!connected) return true;
  return myId < peerId;
}

export function isAvailable(){
  return coopAvailable;
}
