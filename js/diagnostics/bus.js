(function(global){
  var CAPACITY = 2000;
  var buffer = new Array(CAPACITY);
  var index = 0;
  var length = 0;

  /**
   * @typedef {Object} DiagEvent
   * @property {string} topic
   * @property {number} ts
   * @property {string=} message
   * @property {string=} source
   * @property {any=} args
   * @property {any=} stack
   * @property {any=} data
   */

  function normalizeEvent(event) {
    if (!event || typeof event !== 'object') return null;
    var normalized = {};
    for (var key in event) {
      if (Object.prototype.hasOwnProperty.call(event, key)) {
        normalized[key] = event[key];
      }
    }
    if (normalized.ts == null) {
      normalized.ts = Date.now();
    }
    return normalized;
  }

  var bus = {
    /**
     * @param {DiagEvent} event
     */
    emit: function(event) {
      var normalized = normalizeEvent(event);
      if (!normalized) return;
      buffer[index] = normalized;
      index = (index + 1) % CAPACITY;
      if (length < CAPACITY) {
        length += 1;
      }
    },
    /**
     * @returns {DiagEvent[]}
     */
    getAll: function() {
      var out = [];
      for (var i = 0; i < length; i++) {
        var idx = index - length + i;
        if (idx < 0) {
          idx += CAPACITY;
        }
        var item = buffer[idx];
        if (item) {
          out.push(item);
        }
      }
      return out;
    }
  };

  if (global) {
    global.DiagnosticsBus = bus;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
