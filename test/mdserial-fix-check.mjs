// test/mdserial-fix-check.mjs — 验证 mdserial.js 修复（wikilink / callout kind）+ BUG1 路径穿越修复
// 复用 native-check.mjs 的 CDP 客户端模式（Node 原生 WebSocket，无依赖）。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20810;
const CDP = 19310;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const tmp = mkdtempSync(join(tmpdir(), 'mdl-mdfix-'));
const docDir = join(tmp, 'docs');
const { mkdirSync } = await import('node:fs');
mkdirSync(docDir);
// 文档目录外的"秘密"图片（BUG1 验证）
writeFileSync(join(tmp, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x53, 0x45, 0x43]));
writeFileSync(join(docDir, 'a.md'), '# 测试 wikilink 与 callout\n\n[[目标页|链接文字]]\n\n> [!INFO] 这是一条 info\n');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

async function cdpTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('CDP endpoint never appeared');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  return {
    ready,
    send(method, params) {
      const mid = ++id;
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    },
    close() { try { ws.close(); } catch (e) {} },
  };
}

const procs = [];
function spawnProc(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: 'ignore', ...opts });
  procs.push(p);
  return p;
}

try {
  spawnProc(process.execPath, [join(ROOT, 'mdlight.mjs'), join(docDir, 'a.md'), '--no-window', '--port', String(PORT)]);
  spawnProc(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmp, 'prof'), '--remote-debugging-port=' + CDP, 'about:blank']);
  await sleep(4000);

  console.log('\n[0] BUG1 相对图片路径穿越修复');
  let r = await fetch('http://127.0.0.1:' + PORT + '/ok.png').catch(() => null);
  ok(!r || r.status === 404, '不存在的 /ok.png -> 404（无此文件，正常）');
  r = await fetch('http://127.0.0.1:' + PORT + '/..%2fsecret.png');
  const body = Buffer.from(await r.arrayBuffer());
  ok(r.status === 403 || r.status === 404, '编码穿越 /..%2fsecret.png 被拒 -> ' + r.status);
  ok(!(r.status === 200 && body.length === 8), '未读到目录外的 secret.png');

  const wsUrl = await cdpTarget();
  const client = makeClient(wsUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(2500);

  async function ev(expression) {
    const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
    return r && r.result && r.result.value;
  }

  console.log('\n[1] MDLSerialize 已加载');
  ok(await ev('typeof window.MDLSerialize') === 'object', 'window.MDLSerialize 存在');

  console.log('\n[2] wikilink 序列化修复');
  const wl = await ev(`(function(){
    var a = document.createElement('a');
    a.className = 'mdl-wikilink';
    a.setAttribute('data-wikilink', '目标页');
    a.textContent = '链接文字';
    return window.MDLSerialize.inline(a);
  })()`);
  ok(wl === '[[目标页|链接文字]]', 'wikilink -> [[目标页|链接文字]] (实际: ' + wl + ')');

  const wlSame = await ev(`(function(){
    var a = document.createElement('a');
    a.className = 'mdl-wikilink';
    a.setAttribute('data-wikilink', '目标页');
    a.textContent = '目标页';
    return window.MDLSerialize.inline(a);
  })()`);
  ok(wlSame === '[[目标页]]', 'label==target -> [[目标页]] (实际: ' + wlSame + ')');

  console.log('\n[3] callout kind 序列化修复');
  for (const kind of ['INFO', 'SUCCESS', 'QUESTION', 'EXAMPLE', 'NOTE', 'TIP', 'WARNING', 'CAUTION', 'IMPORTANT']) {
    const out = await ev(`(function(){
      var k = '${kind}'.toLowerCase();
      var wrap = document.createElement('div');   // serialize walks a container's children
      var b = document.createElement('blockquote');
      b.className = 'mdl-callout mdl-callout--' + k;
      var p = document.createElement('p');
      p.textContent = '正文';
      b.appendChild(p);
      wrap.appendChild(b);
      return window.MDLSerialize.serialize(wrap);
    })()`);
    ok(String(out).indexOf('[!' + kind + ']') !== -1, kind + ' 保留 (实际: ' + JSON.stringify(out) + ')');
  }

  console.log('\n[4] 嵌套列表序列化（子列表文本不重复）');
  const nested = await ev(`(function(){
    var wrap = document.createElement('div');
    var ul = document.createElement('ul');
    var li1 = document.createElement('li'); li1.textContent = '父项';
    var sub = document.createElement('ul');
    var subli = document.createElement('li'); subli.textContent = '子项';
    sub.appendChild(subli);
    li1.appendChild(sub);
    var li2 = document.createElement('li'); li2.textContent = '第二项';
    ul.appendChild(li1); ul.appendChild(li2);
    wrap.appendChild(ul);
    return window.MDLSerialize.serialize(wrap);
  })()`);
  // Expected: "- 父项\n  - 子项\n- 第二项\n\n"
  // BUG before fix: "- 父项子项\n  - 子项\n- 第二项\n\n" (子项 duplicated in parent body)
  ok(String(nested) === '- 父项\n  - 子项\n\n- 第二项\n\n',
     '嵌套列表子项不重复 (实际: ' + JSON.stringify(nested) + ')');
  ok(String(nested).indexOf('父项子项') === -1,
     '父项 body 不包含子项文本 (无 "父项子项" 拼接)');

  console.log('\n[5] mermaid WYSIWYG 编辑保留（data-mm-src 不覆盖用户编辑）');
  const mmEdited = await ev(`(function(){
    var wrap = document.createElement('div');
    var mm = document.createElement('x-mermaid');
    mm.setAttribute('data-mm-src', 'graph TD\\n  A-->B');
    // Simulate normalizeForEdit: swap SVG for editable pre.mdl-mermaid-src > code
    var pre = document.createElement('pre'); pre.className = 'mdl-mermaid-src';
    var code = document.createElement('code');
    code.textContent = 'graph TD\\n  A-->C\\n  C-->D'; // user edited B->C, added C->D
    pre.appendChild(code);
    mm.appendChild(pre);
    wrap.appendChild(mm);
    return window.MDLSerialize.serialize(wrap);
  })()`);
  // BUG before fix: serialize reads data-mm-src (original "A-->B"), losing the edit
  ok(String(mmEdited).indexOf('A-->C') !== -1,
     'mermaid 编辑后的源码保留 (含 A-->C) (实际: ' + JSON.stringify(mmEdited) + ')');
  ok(String(mmEdited).indexOf('C-->D') !== -1,
     'mermaid 新增的行保留 (含 C-->D) (实际: ' + JSON.stringify(mmEdited) + ')');
  ok(String(mmEdited).indexOf('A-->B') === -1,
     '旧源码 A-->B 不再出现 (编辑已覆盖) (实际: ' + JSON.stringify(mmEdited) + ')');

  client.close();
  console.log('\n[done] ' + pass + ' ✓, ' + fail + ' ✗');
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('FATAL', e);
  process.exit(1);
} finally {
  for (const p of procs) { try { p.kill('SIGKILL'); } catch (e) {} }
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}