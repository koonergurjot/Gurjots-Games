// Web Worker wrapper around the Stockfish engine.
const engine = new Worker(new URL('./stockfish.js', import.meta.url), { type: 'classic' });

engine.onmessage = (e) => {
  const line = e.data;
  if (typeof line === 'string') {
    if (line.startsWith('bestmove')) {
      const uci = line.split(' ')[1] ?? null;
      postMessage({ type: 'bestmove', uci: (uci && uci !== '(none)' && uci !== '0000') ? uci : null });
    } else if (line.startsWith('info')) {
      const parts = line.split(' ');
      const depthIdx = parts.indexOf('depth');
      const scoreIdx = parts.indexOf('score');
      const pvIdx = parts.indexOf('pv');
      let cp = null;
      let mate = null;
      if (scoreIdx !== -1) {
        const type = parts[scoreIdx + 1];
        const val = parseInt(parts[scoreIdx + 2], 10);
        if (type === 'cp') cp = val;
        else if (type === 'mate') mate = val;
      }
      const depth = depthIdx !== -1 ? parseInt(parts[depthIdx + 1], 10) : undefined;
      const pv = pvIdx !== -1 ? parts.slice(pvIdx + 1).join(' ') : undefined;
      postMessage({ type: 'info', depth, cp, mate, pv });
    } else if (line === 'readyok') {
      postMessage({ type: 'ready' });
    }
  }
};

engine.postMessage('uci');
engine.postMessage('isready');

onmessage = (e) => {
  const data = e.data || {};
  if (data.type === 'position') {
    engine.postMessage(`position fen ${data.fen}`);
  } else if (data.type === 'go') {
    if (typeof data.skill === 'number') {
      engine.postMessage(`setoption name Skill Level value ${data.skill}`);
    }
    const depth = typeof data.depth === 'number' ? data.depth : '';
    engine.postMessage(`go${depth ? ' depth ' + depth : ''}`);
  } else if (data.type === 'stop') {
    engine.postMessage('stop');
  }
};
