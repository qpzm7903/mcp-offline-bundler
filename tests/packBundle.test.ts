import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packBundle, PackBundleError } from '../src/build/packBundle.js';

const MANIFEST_YAML = `bundle:
  name: test-offline-bundle
  target: linux-x64
  node: ">=20"
  archiveName: packed-bundle

servers:
  - name: alpha
    package: alpha-mcp
    version: "1.2.3"
    bin: alpha-bin
`;

describe('packBundle', () => {
  let tmpRoot: string;
  let workdir: string;
  let outDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mcp-pack-'));
    workdir = join(tmpRoot, 'work', 'bundle');
    outDir = join(tmpRoot, 'dist');
    await mkdir(workdir, { recursive: true });
    await writeFile(join(workdir, 'manifest.yaml'), MANIFEST_YAML, 'utf8');
    await writeFile(join(workdir, 'package.json'), '{}\n', 'utf8');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('packs a workdir using the manifest archiveName', async () => {
    const result = await packBundle({ workdir, outDir });
    expect(result.archive.archiveFileName).toBe('packed-bundle.tar.gz');
    expect((await stat(result.archive.archivePath)).isFile()).toBe(true);

    const content = await readFile(result.checksums.checksumsPath, 'utf8');
    expect(content).toMatch(/^[0-9a-f]{64} {2}packed-bundle\.tar\.gz\n$/);
  });

  it('throws PackBundleError when no manifest.yaml is present', async () => {
    const empty = join(tmpRoot, 'empty');
    await mkdir(empty, { recursive: true });
    await expect(packBundle({ workdir: empty, outDir })).rejects.toThrow(PackBundleError);
  });
});
