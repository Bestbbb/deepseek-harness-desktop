/** Packaged pnpm launchers use the adjacent Node runtime after relocation. */
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('runs relocated pnpm without a developer PATH and refuses replacing prepared files', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
    import { join } from 'node:path';
    import { tmpdir } from 'node:os';
    import { spawnSync } from 'node:child_process';
    import { preparePackageManager } from './apps/desktop/scripts/runtime-package-manager.mjs';
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-pnpm-'));
    try {
      const output = join(temporary, 'runtime');
      await mkdir(output);
      const version = await preparePackageManager(output);
      const executable = process.platform === 'win32' ? 'node.exe' : 'node';
      await copyFile(process.execPath, join(output, 'node', executable));
      const moved = join(temporary, 'relocated runtime');
      await rename(output, moved);
      const bin = join(moved, 'node');
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(key)));
      env.PATH = bin;
      env.HOME = temporary;
      env.USERPROFILE = temporary;
      const run = spawnSync('pnpm', ['--version'], {
        cwd: moved, env, shell: process.platform === 'win32', encoding: 'utf8', timeout: 20000,
      });
      assert.equal(run.error, undefined);
      assert.equal(run.signal, null);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.trim(), version);
      const original = await readFile(join(bin, 'pnpm'), 'utf8');
      await assert.rejects(preparePackageManager(moved));
      assert.equal(await readFile(join(bin, 'pnpm'), 'utf8'), original);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  `], {
    encoding: 'utf8', timeout: 60_000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(name))),
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
})
