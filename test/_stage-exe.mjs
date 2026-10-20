// test/_stage-exe.mjs
// Returns a path to a runnable copy of dist/native/mdlight.exe.
//
// Why a copy instead of the built file itself: a Windows sandbox (the DSH/Codex
// sandbox that owns this checkout, for example) can put a low-integrity
// mandatory label plus a restricted ACL on the project directory. An exe started
// from such a directory inherits a restricted token, so `new HttpListener()`
// throws PlatformNotSupportedException and every AppData write is denied; the
// native host then dies with "无法启动本地服务: 此平台上不支持操作。" and every
// test that talks to it fails — which looks exactly like a renderer regression.
// The same exe copied anywhere outside that directory runs fine.
//
// The exe is single-file and self-contained (assets live in its embedded
// pack.bin), so a plain copy in the OS temp dir behaves identically.
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EXE_SRC = join(root, 'dist', 'native', 'mdlight.exe');

let staged = null;

/** Path to spawn. Falls back to the built path when staging is impossible. */
export function exePath() {
  if (staged) return staged;
  if (!existsSync(EXE_SRC)) return (staged = EXE_SRC);
  try {
    const dir = mkdtempSync(join(tmpdir(), 'mdl-exe-'));
    const copy = join(dir, 'mdlight.exe');
    copyFileSync(EXE_SRC, copy);
    staged = copy;
  } catch (e) {
    staged = EXE_SRC;
  }
  return staged;
}
