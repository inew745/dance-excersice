/**
 * Builds the Next app in standalone mode and assembles everything the packaged
 * desktop app needs under desktop/app.
 *
 * Next's standalone output deliberately omits .next/static and public — they
 * are normally served by a CDN — so they have to be copied in by hand or the
 * app loads with no CSS and no assets.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'desktop', 'app');

const step = (label, cmd, args, env) => {
  process.stdout.write(`\n▸ ${label}\n`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(res.status ?? 1);
  }
};

rmSync(join(root, 'desktop'), { recursive: true, force: true });

step('next build (standalone)', 'npx', ['next', 'build'], { BUILD_DESKTOP: '1' });

const standalone = join(root, '.next', 'standalone');
if (!existsSync(standalone)) {
  console.error('\n✗ .next/standalone is missing — is output: "standalone" active?');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(standalone, out, { recursive: true });
cpSync(join(root, '.next', 'static'), join(out, '.next', 'static'), { recursive: true });
if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(out, 'public'), { recursive: true });
}

console.log(`\n✓ desktop bundle ready at ${out}`);
