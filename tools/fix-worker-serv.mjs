import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');
// Use fetch + Blob URL instead of new Worker(url): the Node host serves the
// worker script via /assets/renderer-worker.js but classic Worker loading can
// be flaky cross-origin; a Blob URL sidesteps that entirely.
const old = "    var w = new Worker('/assets/renderer-worker.js');";
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = `    // Load the worker via fetch + Blob so it works on both the Node host
    // (which serves /assets/renderer-worker.js) and the native host without
    // any cross-origin restrictions.
    if (workerBlob) {
      var w = new Worker(workerBlob, { type: 'classic' });
      wireWorker(w);
      return w;
    }
    fetch('/assets/renderer-worker.js', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        workerBlob = URL.createObjectURL(new Blob([txt], { type: 'application/javascript' }));
        var w = new Worker(workerBlob, { type: 'classic' });
        wireWorker(w);
        workerCache = w;
      })
      .catch(function () {
        // fall back to sync render for all pending + future requests
        var ids = Object.keys(workerCallbacks);
        ids.forEach(function (id) { cbSync(id); });
      });
    return null;`;
s = s.replace(old, nw, 1);

// Add workerBlob var + wireWorker helper before getWorker
const anchor2 = "  function getWorker() {\n";
if (s.indexOf(anchor2) < 0) { console.log('getWorker anchor not found'); process.exit(1); }
const helper = `  var workerBlob = null;
  function wireWorker(w) {
    w.onmessage = function (e) {
      var cid = e.data && e.data.id;
      var cb = workerCallbacks[cid];
      if (cb) { delete workerCallbacks[cid]; cb(e.data); }
    };
    w.onerror = function () {
      var ids = Object.keys(workerCallbacks);
      workerCallbacks = {};
      ids.forEach(function (id) { cbSync(id); });
      try { w.terminate(); } catch (e2) {}
      workerCache = null;
      if (workerBlob) { URL.revokeObjectURL(workerBlob); workerBlob = null; }
    };
    workerCache = w;
  }
`;
s = s.replace(anchor2, helper + anchor2, 1);
writeFileSync('ui/app.js', s);
console.log('fix-worker-serv done');
