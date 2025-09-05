
/**
 * chess.js wrapper (expected at ./chess.min.js). This stub avoids crashes if the vendor file is missing.
 */
export let ready = false;
let ChessCtor, game;

export async function init(){
  try {
    const mod = await import('./chess.min.js');
    ChessCtor = mod.default || mod.Chess || mod;
    game = new ChessCtor();
    ready = true;
  } catch (e){
    console.warn('[Chess3D] chess.min.js not found; rules will be inert.', e);
    ready = false;
  }
}

export function loadFEN(fen){
  if (!ready) return;
  if (!fen) game.reset();
  else game.load(fen);
}

export function getLegalMoves(square){
  if (!ready) return [];
  return game.moves({ square, verbose:true }).map(m => ({from:m.from,to:m.to,promotion:m.promotion}));
}

export function move({from,to,promotion}){
  if (!ready) return {ok:false};
  const res = game.move({ from, to, promotion });
  return res ? { ok:true, san:res.san, flags:res.flags } : { ok:false };
}

export function undo(){ if (ready) game.undo(); }
export function fen(){ return ready ? game.fen() : 'startpos'; }
export function turn(){ return ready ? game.turn() : 'w'; }
export function inCheck(){ return ready ? game.in_check() : false; }
export function inCheckmate(){ return ready ? game.in_checkmate() : false; }
export function inStalemate(){ return ready ? game.in_stalemate() : false; }
