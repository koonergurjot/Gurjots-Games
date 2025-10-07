const ChessNet = (() => {
  let ws;
  let moveHandler = () => {};
  let playersHandler = () => {};
  let statusHandler = () => {};

  function connect(url, rating) {
    if (ws) ws.close();
    ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', rating }));
      statusHandler('Waiting for opponent...');
    };
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'move' && msg.move) {
          moveHandler(msg.move);
        } else if (msg.type === 'players' && Array.isArray(msg.players)) {
          playersHandler(msg.players);
        } else if (msg.type === 'status' && msg.message) {
          statusHandler(msg.message);
        }
      } catch(err) {
        import('../../tools/reporters/console-signature.js').then(({ error }) => {
          error('chess', 'Bad message', err);
        });
      }
    };
    ws.onclose = () => statusHandler('Disconnected');
  }

  function sendMove(move) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'move', move }));
    }
  }

  return {
    connect,
    sendMove,
    onMove: cb => { moveHandler = cb; },
    onPlayers: cb => { playersHandler = cb; },
    onStatus: cb => { statusHandler = cb; }
  };
})();

if (typeof window !== 'undefined') {
  window.ChessNet = ChessNet;
}
