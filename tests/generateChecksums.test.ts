import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatChecksumLine,
  generateChecksums,
  sha256File,
  CHECKSUMS_FILE_NAME,
} from '../src/build/generateChecksums.js';

describe('generateChecksums', () => {
  let tmpRoot: string;
  let archivePath: string;
  let outDir: string;
  const payload = 'hello mcp offline bundle\n';

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mcp-checksum-'));
    outDir = join(tmpRoot, 'dist');
    archivePath = join(tmpRoot, 'mcp-offline-bundle-linux-x64.tar.gz');
    await writeFile(archivePath, payload, 'utf8');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('formats a line as `<sha256>  <fileName>` (two spaces)', () => {
    const line = formatChecksumLine('a'.repeat(64), 'foo.tar.gz');
    expect(line).toBe(`${'a'.repeat(64)}  foo.tar.gz`);
  });

  it('computes the correct SHA-256 of the archive file', async () => {
    const expected = createHash('sha256').update(payload).digest('hex');
    expect(await sha256File(archivePath)).toBe(expected);
  });

  it('writes checksums.txt with the sha256sum format and trailing newline', async () => {
    const result = await generateChecksums({ archivePath, outDir });
    const expected = createHash('sha256').update(payload).digest('hex');

    expect(result.sha256).toBe(expected);
    expect(result.checksumsPath).toBe(join(outDir, CHECKSUMS_FILE_NAME));

    const content = await readFile(result.checksumsPath, 'utf8');
    expect(content).toBe(`${expected}  mcp-offline-bundle-linux-x64.tar.gz\n`);
    expect(result.bundleChecksumsPath).toBeNull();
  });

  it('also copies checksums.txt into the bundle dir when provided', async () => {
    const bundleDir = join(tmpRoot, 'work', 'bundle');
    const result = await generateChecksums({ archivePath, outDir, bundleDir });

    expect(result.bundleChecksumsPath).toBe(join(bundleDir, CHECKSUMS_FILE_NAME));
    expect((await stat(result.bundleChecksumsPath!)).isFile()).toBe(true);
    const a = await readFile(result.checksumsPath, 'utf8');
    const b = await readFile(result.bundleChecksumsPath!, 'utf8');
    expect(a).toBe(b);
  });
});
