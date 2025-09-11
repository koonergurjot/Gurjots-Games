export function connect(room, handlers = {}) {
  const bc = new BroadcastChannel('maze3d-' + room);
  bc.onmessage = (e) => {
    const { type, data } = e.data || {};
    const fn = handlers[type];
    if (fn) fn(data);
  };
  return {
    send(type, data) {
      bc.postMessage({ type, data });
    },
    close() { bc.close(); }
  };
}
