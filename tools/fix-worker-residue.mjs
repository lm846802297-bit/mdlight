import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');
// Remove the dead code residue: from "    return null;\n" (end of the new getWorker)
// through the old onmessage/onerror/workerCache/return-w block, keeping the closing "  }"
const old = `    return null;
    w.onmessage = function (e) {
      var id = e.data && e.data.id;
      var cb = workerCallbacks[id];
      if (cb) { delete workerCallbacks[id]; cb(e.data); }
    };
    w.onerror = function () {
      // worker 加载/运行失败：把所有挂起的请求回退到同步渲染
      var ids = Object.keys(workerCallbacks);
      workerCallbacks = {};
      ids.forEach(function (id) { cbSync(id); });
      try { w.terminate(); } catch (e) {}
      workerCache = null;
    };
    workerCache = w;
    return w;
  }`;
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
s = s.replace(old, '    return null;\n  }', 1);
writeFileSync('ui/app.js', s);
console.log('fix-worker-residue done');
