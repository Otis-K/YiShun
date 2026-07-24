'use strict';

class ModelTaskQueue {
  constructor(maxConcurrent = 1) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new TypeError('maxConcurrent must be a positive integer');
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.pending = [];
  }

  submit(run, signal) {
    if (typeof run !== 'function') return Promise.reject(new TypeError('run must be a function'));
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(new DOMException('Generation cancelled.', 'AbortError')); return; }
      const item = { run, resolve, reject, signal, settled: false };
      const onAbort = () => {
        const index = this.pending.indexOf(item);
        if (index < 0 || item.settled) return;
        this.pending.splice(index, 1);
        item.settled = true;
        reject(new DOMException('Generation cancelled.', 'AbortError'));
      };
      item.onAbort = onAbort;
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      this.pending.push(item);
      this.pump();
    });
  }

  pump() {
    while (this.active < this.maxConcurrent && this.pending.length) {
      const item = this.pending.shift();
      if (item.signal) item.signal.removeEventListener('abort', item.onAbort);
      if (item.signal && item.signal.aborted) {
        item.settled = true;
        item.reject(new DOMException('Generation cancelled.', 'AbortError'));
        continue;
      }
      this.active += 1;
      Promise.resolve().then(item.run).then(item.resolve, item.reject).finally(() => {
        item.settled = true;
        this.active -= 1;
        this.pump();
      });
    }
  }
}

module.exports = { ModelTaskQueue };
