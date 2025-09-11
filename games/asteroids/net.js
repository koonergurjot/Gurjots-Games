// Simple network helper for Asteroids Co-op Campaign
// Handles WebSocket connections and sync of ships, bullets and asteroids.

import { warn } from '../../tools/reporters/console-signature.js';

let ws;
let myId = null;
const players = {}; // remote players { id: {score,lives} }

const cbs = {
  ship: [],
  shot: [],
  rocks: [],
  players: []
};

function connect(){
  if (ws && ws.readyState <= 1) return; // already connected or connecting
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}/ws/asteroids`);
  } catch(err){
    warn('asteroids', 'WebSocket unavailable', err);
    return;
  }
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join' }));
  ws.onmessage = (e)=>{
    let msg;
    try{ msg = JSON.parse(e.data); }catch(err){ return; }
    const { type } = msg;
    if (type === 'welcome'){ myId = msg.id; }
    else if (type === 'ship' && msg.id !== myId){ cbs.ship.forEach(f=>f(msg.id, msg.ship)); }
    else if (type === 'shot' && msg.id !== myId){ cbs.shot.forEach(f=>f(msg.id, msg.bullet)); }
    else if (type === 'rocks'){ cbs.rocks.forEach(f=>f(msg.rocks)); }
    else if (type === 'stats' && msg.id !== myId){
      players[msg.id] = { score: msg.score, lives: msg.lives };
      cbs.players.forEach(f=>f(players));
    }
    else if (type === 'leave'){
      delete players[msg.id];
      cbs.players.forEach(f=>f(players));
    }
  };
  ws.onclose = ()=>{ ws=null; myId=null; for(const id in players) delete players[id]; cbs.players.forEach(f=>f(players)); };
}

function disconnect(){
  if (ws){ ws.close(); }
}

function send(type, data){
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, ...data, id: myId }));
}

function sendShip(ship){ send('ship', { ship }); }
function sendShot(bullet){ send('shot', { bullet }); }
function sendRocks(rocks){ send('rocks', { rocks }); }
function sendStats(score, lives){ send('stats', { score, lives }); }

function onShip(cb){ cbs.ship.push(cb); }
function onShot(cb){ cbs.shot.push(cb); }
function onRocks(cb){ cbs.rocks.push(cb); }
function onPlayers(cb){ cbs.players.push(cb); }

export { connect, disconnect, sendShip, sendShot, sendRocks, sendStats, onShip, onShot, onRocks, onPlayers, players };
