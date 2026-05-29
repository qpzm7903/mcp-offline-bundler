import { describe, expect, it, vi } from 'vitest';
import {
  buildInstallEnv,
  InstallDependenciesError,
  installDependencies,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD,
  type ExecaLike,
} from '../src/build/installDependencies.js';
import type { Manifest } from '../src/manifest/schema.js';

function makeManifest(overrides?: Partial<Manifest['install']>): Manifest {
  return {
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    install: { packageManager: 'npm', omitDev: true, env: {}, ...overrides },
    servers: [
      {
        name: 'alpha',
        package: 'alpha-mcp',
        version: '1.2.3',
        bin: 'alpha-bin',
        transport: 'stdio',
        args: [],
        env: {},
        smokeTestArgs: ['--help'],
      },
    ],
    clients: { claudeDesktop: true, codex: true, cursor: true, genericJson: true },
  } as Manifest;
}

function okResult(stdout = '', stderr = '') {
  // Mimics the awaited execa result shape we read.
  return Promise.resolve({ exitCode: 0, stdout, stderr }) as unknown as ReturnType<ExecaLike>;
}

describe('installDependencies (mocked execa)', () => {
  it('uses `npm ci --omit=dev` when a lockfile exists', async () => {
    const exec = vi.fn(() => okResult('added 5 packages')) as unknown as ExecaLike;
    const result = await installDependencies({
      bundleDir: '/tmp/bundle',
      manifest: makeManifest(),
      exec,
      lockfileExists: () => Promise.resolve(true),
    });

    expect(result.command).toBe('ci');
    expect(result.usedLockfile).toBe(true);
    expect(result.args).toEqual(['ci', '--omit=dev']);
    const call = (exec as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('npm');
    expect(call[1]).toEqual(['ci', '--omit=dev']);
    expect(call[2].cwd).toBe('/tmp/bundle');
  });

  it('uses `npm install --omit=dev` when no lockfile exists', async () => {
    const exec = vi.fn(() => okResult()) as unknown as ExecaLike;
    const result = await installDependencies({
      bundleDir: '/tmp/bundle',
      manifest: makeManifest(),
      exec,
      lockfileExists: () => Promise.resolve(false),
    });

    expect(result.command).toBe('install');
    expect(result.usedLockfile).toBe(false);
    expect(result.args).toEqual(['install', '--omit=dev']);
  });

  it('defaults PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 and merges install.env', async () => {
    const capturedEnv: Record<string, string | undefined>[] = [];
    const exec = vi.fn((_file, _args, opts) => {
      capturedEnv.push(opts.env);
      return okResult();
    }) as unknown as ExecaLike;

    await installDependencies({
      bundleDir: '/tmp/bundle',
      manifest: makeManifest({ env: { MY_TOKEN: 'abc' } }),
      exec,
      lockfileExists: () => Promise.resolve(true),
    });

    expect(capturedEnv[0][PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD]).toBe('1');
    expect(capturedEnv[0].MY_TOKEN).toBe('abc');
  });

  it('respects an explicit PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD from install.env', () => {
    const env = buildInstallEnv(makeManifest({ env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0' } }));
    expect(env[PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD]).toBe('0');
  });

  it('throws InstallDependenciesError surfacing command, code and logs on failure', async () => {
    const exec = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('npm failed'), {
          exitCode: 1,
          stdout: 'npm WARN something',
          stderr: 'npm ERR! network ETIMEDOUT',
        }),
      ),
    ) as unknown as ExecaLike;

    await expect(
      installDependencies({
        bundleDir: '/tmp/bundle',
        manifest: makeManifest(),
        exec,
        lockfileExists: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(InstallDependenciesError);

    try {
      await installDependencies({
        bundleDir: '/tmp/bundle',
        manifest: makeManifest(),
        exec,
        lockfileExists: () => Promise.resolve(true),
      });
    } catch (error) {
      const e = error as InstallDependenciesError;
      expect(e.command).toBe('npm ci --omit=dev');
      expect(e.exitCode).toBe(1);
      expect(e.message).toContain('npm ci --omit=dev');
      expect(e.message).toContain('exited with code 1');
      expect(e.message).toContain('ETIMEDOUT');
    }
  });
});
