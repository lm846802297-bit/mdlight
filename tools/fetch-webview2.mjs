// One-time build helper: vendor the WebView2 SDK from NuGet into vendor/webview2/.
//
// This is the ONLY build-time download for the native host. End users need
// nothing: the .NET Framework (csc.exe) ships with Windows and the WebView2
// runtime ships with Windows 10/11.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheDir = join(root, 'build', 'cache');
const tmpDir = join(cacheDir, 'nupkg');
const outDir = join(root, 'vendor', 'webview2');
const nupkg = join(cacheDir, 'microsoft.web.webview2.zip');

const NEEDED = [
  ['lib/net462/Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Core.dll'],
  ['lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'Microsoft.Web.WebView2.WinForms.dll'],
  ['runtimes/win-x64/native/WebView2Loader.dll', 'WebView2Loader.dll'],
];

const exists = (p) => existsSync(p);

function main() {
  if (NEEDED.every(([, name]) => exists(join(outDir, name)))) {
    console.log('WebView2 SDK 已就绪 (vendor/webview2/)，跳过');
    return;
  }
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  if (!exists(nupkg)) {
    console.log('下载 WebView2 SDK (~9.8 MB, 仅构建期一次)...');
    execFileSync('curl.exe', [
      '-sSL', '--fail', '-o', nupkg,
      'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2',
    ], { stdio: 'inherit' });
  }

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  // .nupkg is a zip; PowerShell is always present, so no extra tooling needed.
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${nupkg}' -DestinationPath '${tmpDir}' -Force`,
  ], { stdio: 'inherit' });

  for (const [src, name] of NEEDED) {
    const from = join(tmpDir, src);
    if (!exists(from)) throw new Error('SDK 包内缺少 ' + src);
    copyFileSync(from, join(outDir, name));
  }
  rmSync(tmpDir, { recursive: true, force: true });

  const total = NEEDED.reduce((n, [, name]) => n + statSync(join(outDir, name)).size, 0);
  console.log(`WebView2 SDK 就绪: ${NEEDED.length} 个文件 / ${(total / 1024).toFixed(0)} KB → vendor/webview2/`);
}

try {
  main();
} catch (e) {
  console.error('获取 WebView2 SDK 失败:', e.message);
  process.exit(1);
}
