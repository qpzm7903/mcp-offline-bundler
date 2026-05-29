import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  runSmokeTests,
  SmokeTestError,
  SMOKE_TEST_TIMEOUT_MS,
  type SmokeExecaLike,
} from '../src/build/runSmokeTests.js';
import type { Manifest } from '../src/manifest/schema.js';

function makeManifest(servers: Manifest['servers']): Manifest {
  return {
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    install: { packageManager: 'npm', omitDev: true, env: {} },
    servers,
    clients: { claudeDesktop: true, codex: true, cursor: true, genericJson: true },
  } as Manifest;
}

function server(name: string, smokeTestArgs: string[]): Manifest['servers'][number] {
  return {
    name,
    package: `${name}-mcp`,
    version: '1.0.0',
    bin: `${name}-bin`,
    transport: 'stdio',
    args: [],
    env: {},
    smokeTestArgs,
  } as Manifest['servers'][number];
}

function ok(stdout = '') {
  return Promise.resolve({ exitCode: 0, stdout, stderr: '' }) as unknown as ReturnType<
    SmokeExecaLike
  >;
}

describe('runSmokeTests (mocked execa)', () => {
  it('runs each wrapper with its smokeTestArgs and a 20s timeout', async () => {
    const exec = vi.fn(() => ok('usage')) as unknown as SmokeExecaLike;
    const manifest = makeManifest([
      server('alpha', ['--help']),
      server('beta', ['--version', '--quiet']),
    ]);

    const results = await runSmokeTests({ bundleDir: '/tmp/bundle', manifest, exec });

    expect(results.map((r) => r.server)).toEqual(['alpha', 'beta']);
    expect(results.every((r) => r.exitCode === 0)).toBe(true);

    const calls = (exec as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe(join('/tmp/bundle', 'bin', 'alpha'));
    expect(calls[0][1]).toEqual(['--help']);
    expect(calls[0][2].timeout).toBe(SMOKE_TEST_TIMEOUT_MS);
    expect(calls[1][0]).toBe(join('/tmp/bundle', 'bin', 'beta'));
    expect(calls[1][1]).toEqual(['--version', '--quiet']);
  });

  it('throws SmokeTestError on non-zero exit and lists the failing server', async () => {
    const exec = vi.fn((file: string) => {
      if (file.endsWith('beta')) {
        return Promise.reject(
          Object.assign(new Error('boom'), { exitCode: 2, stdout: '', stderr: 'bad flag' }),
        );
      }
      return ok();
    }) as unknown as SmokeExecaLike;

    const manifest = makeManifest([server('alpha', ['--help']), server('beta', ['--help'])]);

    await expect(runSmokeTests({ bundleDir: '/tmp/bundle', manifest, exec })).rejects.toThrow(
      SmokeTestError,
    );

    try {
      await runSmokeTests({ bundleDir: '/tmp/bundle', manifest, exec });
    } catch (error) {
      const e = error as SmokeTestError;
      expect(e.results).toHaveLength(1);
      expect(e.results[0].server).toBe('beta');
      expect(e.message).toContain('beta');
      expect(e.message).toContain('exited with code 2');
      expect(e.message).toContain('bad flag');
    }
  });

  it('reports a timeout as a failure', async () => {
    const exec = vi.fn(() =>
      Promise.reject(Object.assign(new Error('timed out'), { timedOut: true, stderr: '' })),
    ) as unknown as SmokeExecaLike;
    const manifest = makeManifest([server('alpha', ['--help'])]);

    try {
      await runSmokeTests({ bundleDir: '/tmp/bundle', manifest, exec });
      throw new Error('expected SmokeTestError');
    } catch (error) {
      const e = error as SmokeTestError;
      expect(e).toBeInstanceOf(SmokeTestError);
      expect(e.results[0].timedOut).toBe(true);
      expect(e.message).toContain('timed out after 20s');
    }
  });
});
