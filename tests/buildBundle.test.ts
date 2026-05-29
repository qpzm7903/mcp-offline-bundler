import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBundle, resolveBuildPaths } from '../src/build/buildBundle.js';
import { SmokeTestError } from '../src/build/runSmokeTests.js';

const MANIFEST_YAML = `bundle:
  name: test-offline-bundle
  target: linux-x64
  node: ">=20"
  archiveName: mcp-offline-bundle-linux-x64

servers:
  - name: alpha
    package: alpha-mcp
    version: "1.2.3"
    bin: alpha-bin
    args:
      - "--flag"
    env:
      ALPHA_TOKEN: "1"
    smokeTestArgs:
      - "--help"
  - name: beta
    package: "@scope/beta"
    version: "2.0.0"
    bin: beta-bin

clients:
  claudeDesktop: true
  codex: true
  cursor: true
  genericJson: true
`;

describe('buildBundle (Phase 5: no install)', () => {
  let tmpRoot: string;
  let manifestPath: string;
  let outDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mcp-build-'));
    manifestPath = join(tmpRoot, 'mcp.manifest.yaml');
    outDir = join(tmpRoot, 'dist');
    await writeFile(manifestPath, MANIFEST_YAML, 'utf8');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates the expected bundle directory structure', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    const { bundleDir } = result.paths;

    expect(bundleDir).toBe(resolveBuildPaths(outDir).bundleDir);

    for (const rel of [
      'manifest.yaml',
      'package.json',
      'README.md',
      'bin/alpha',
      'bin/beta',
      'configs/generic-mcp.json',
      'configs/claude-desktop.json',
      'configs/codex.toml',
      'configs/cursor.json',
    ]) {
      const info = await stat(join(bundleDir, rel));
      expect(info.isFile(), `${rel} should be a file`).toBe(true);
    }
  });

  it('copies the manifest verbatim into the bundle as manifest.yaml', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    const copied = await readFile(result.manifestCopyPath, 'utf8');
    expect(copied).toBe(MANIFEST_YAML);
  });

  it('does NOT install dependencies (no node_modules created)', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    await expect(stat(join(result.paths.bundleDir, 'node_modules'))).rejects.toThrow();
  });

  it('generates a runtime package.json with exact pinned versions', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    const pkg = JSON.parse(await readFile(result.packageJsonPath, 'utf8')) as {
      name: string;
      private: boolean;
      type: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('mcp-offline-bundle-runtime');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toEqual({ 'alpha-mcp': '1.2.3', '@scope/beta': '2.0.0' });
  });

  it('generates wrappers and configs for every server', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    expect(result.wrappers.map((w) => w.server)).toEqual(['alpha', 'beta']);
    expect(result.configs.map((c) => c.file).sort()).toEqual([
      'claude-desktop.json',
      'codex.toml',
      'cursor.json',
      'generic-mcp.json',
    ]);
  });

  it('writes a README that includes server names and the placeholder', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    const readme = await readFile(result.readmePath, 'utf8');
    expect(readme).toContain('test-offline-bundle');
    expect(readme).toContain('alpha-mcp');
    expect(readme).toContain('@scope/beta');
    expect(readme).toContain('__MCP_BUNDLE_DIR__');
    expect(readme).toContain('sha256sum -c checksums.txt');
  });

  it('clears the work directory between builds (stale files removed)', async () => {
    const { workDir, bundleDir } = resolveBuildPaths(outDir);
    await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    const stalePath = join(bundleDir, 'stale.txt');
    await writeFile(stalePath, 'stale', 'utf8');
    expect((await stat(stalePath)).isFile()).toBe(true);

    await buildBundle({ manifestPath, outDir, skipInstall: true, skipArchive: true });
    await expect(stat(stalePath)).rejects.toThrow();
    // The work dir itself still exists after the rebuild.
    expect((await stat(workDir)).isDirectory()).toBe(true);
  });
});

describe('buildBundle (Phase 6: install + smoke with mocked execution)', () => {
  let tmpRoot: string;
  let manifestPath: string;
  let outDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mcp-build6-'));
    manifestPath = join(tmpRoot, 'mcp.manifest.yaml');
    outDir = join(tmpRoot, 'dist');
    await writeFile(manifestPath, MANIFEST_YAML, 'utf8');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs install then smoke tests with mocked execs and reports results', async () => {
    const installExec = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: 'added', stderr: '' }),
    );
    const smokeExec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: 'usage', stderr: '' }));

    const result = await buildBundle({
      manifestPath,
      outDir,
      skipArchive: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      installExec: installExec as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      smokeExec: smokeExec as any,
    });

    expect(installExec).toHaveBeenCalledTimes(1);
    expect(installExec.mock.calls[0][0]).toBe('npm');
    // One smoke run per server.
    expect(smokeExec).toHaveBeenCalledTimes(2);
    expect(result.install?.command).toBe('install');
    expect(result.smokeTests?.map((s) => s.server)).toEqual(['alpha', 'beta']);
  });

  it('fails the build when a smoke test exits non-zero', async () => {
    const installExec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }));
    const smokeExec = vi.fn((file: string) => {
      if (file.endsWith('beta')) {
        return Promise.reject(
          Object.assign(new Error('boom'), { exitCode: 1, stdout: '', stderr: 'bad' }),
        );
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    });

    await expect(
      buildBundle({
        manifestPath,
        outDir,
        skipArchive: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        installExec: installExec as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        smokeExec: smokeExec as any,
      }),
    ).rejects.toThrow(SmokeTestError);
  });

  it('skipInstall skips both install and smoke tests', async () => {
    const installExec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }));
    const smokeExec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }));

    const result = await buildBundle({
      manifestPath,
      outDir,
      skipInstall: true,
      skipArchive: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      installExec: installExec as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      smokeExec: smokeExec as any,
    });

    expect(installExec).not.toHaveBeenCalled();
    expect(smokeExec).not.toHaveBeenCalled();
    expect(result.install).toBeNull();
    expect(result.smokeTests).toBeNull();
  });

  it('skipSmokeTests runs install but skips smoke tests', async () => {
    const installExec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }));
    const smokeExec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }));

    const result = await buildBundle({
      manifestPath,
      outDir,
      skipSmokeTests: true,
      skipArchive: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      installExec: installExec as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      smokeExec: smokeExec as any,
    });

    expect(installExec).toHaveBeenCalledTimes(1);
    expect(smokeExec).not.toHaveBeenCalled();
    expect(result.install?.command).toBe('install');
    expect(result.smokeTests).toBeNull();
  });
});

describe('buildBundle (Phase 7: archive + checksums)', () => {
  let tmpRoot: string;
  let manifestPath: string;
  let outDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mcp-build7-'));
    manifestPath = join(tmpRoot, 'mcp.manifest.yaml');
    outDir = join(tmpRoot, 'dist');
    await writeFile(manifestPath, MANIFEST_YAML, 'utf8');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('produces a tar.gz and checksums.txt in the out dir', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true });

    // Archive name comes from the manifest's bundle.archiveName.
    expect(result.archive?.archiveFileName).toBe('mcp-offline-bundle-linux-x64.tar.gz');
    expect(result.archive?.archivePath).toBe(
      join(outDir, 'mcp-offline-bundle-linux-x64.tar.gz'),
    );
    expect((await stat(result.archive!.archivePath)).isFile()).toBe(true);

    const checksumsPath = join(outDir, 'checksums.txt');
    expect((await stat(checksumsPath)).isFile()).toBe(true);

    // checksums.txt is also copied into the bundle root.
    const bundleChecksums = join(result.paths.bundleDir, 'checksums.txt');
    expect((await stat(bundleChecksums)).isFile()).toBe(true);
    expect(result.checksums?.bundleChecksumsPath).toBe(bundleChecksums);
  });

  it('writes a checksums.txt line in `<sha256>  <archive>.tar.gz` format', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true });
    const content = await readFile(join(outDir, 'checksums.txt'), 'utf8');
    // sha256sum format: 64 hex chars, two spaces, file name, trailing newline.
    expect(content).toMatch(/^[0-9a-f]{64} {2}mcp-offline-bundle-linux-x64\.tar\.gz\n$/);
    expect(content.trim()).toBe(result.checksums?.line);
    expect(result.checksums?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('archives every bundle entry under the mcp-offline-bundle/ root', async () => {
    const result = await buildBundle({ manifestPath, outDir, skipInstall: true });
    const { list } = await import('tar');
    const entries: string[] = [];
    await list({
      file: result.archive!.archivePath,
      onReadEntry: (entry) => entries.push(entry.path),
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const path of entries) {
      expect(path.startsWith('mcp-offline-bundle/')).toBe(true);
    }
    expect(entries).toContain('mcp-offline-bundle/package.json');
    expect(entries).toContain('mcp-offline-bundle/bin/alpha');
    expect(entries).toContain('mcp-offline-bundle/README.md');
  });

  it('skipArchive produces no archive or checksums', async () => {
    const result = await buildBundle({
      manifestPath,
      outDir,
      skipInstall: true,
      skipArchive: true,
    });
    expect(result.archive).toBeNull();
    expect(result.checksums).toBeNull();
    await expect(stat(join(outDir, 'mcp-offline-bundle-linux-x64.tar.gz'))).rejects.toThrow();
  });
});
