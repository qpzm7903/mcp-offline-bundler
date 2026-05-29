import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { list } from 'tar';
import {
  ARCHIVE_ROOT_DIR,
  DEFAULT_ARCHIVE_NAME,
  createArchive,
} from '../src/build/createArchive.js';

async function listEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = [];
  await list({ file: archivePath, onReadEntry: (e) => entries.push(e.path) });
  return entries;
}

describe('createArchive', () => {
  let tmpRoot: string;
  let bundleDir: string;
  let outDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mcp-archive-'));
    bundleDir = join(tmpRoot, 'work', 'bundle');
    outDir = join(tmpRoot, 'dist');
    await mkdir(join(bundleDir, 'bin'), { recursive: true });
    await writeFile(join(bundleDir, 'package.json'), '{}\n', 'utf8');
    await writeFile(join(bundleDir, 'README.md'), '# readme\n', 'utf8');
    await writeFile(join(bundleDir, 'bin', 'alpha'), '#!/bin/bash\n', 'utf8');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates <archiveName>.tar.gz in the out dir', async () => {
    const result = await createArchive({ bundleDir, outDir, archiveName: 'my-bundle' });
    expect(result.archiveFileName).toBe('my-bundle.tar.gz');
    expect(result.archivePath).toBe(join(outDir, 'my-bundle.tar.gz'));
    expect(result.rootDir).toBe(ARCHIVE_ROOT_DIR);
    expect((await stat(result.archivePath)).isFile()).toBe(true);
  });

  it('defaults the archive name when none is given', async () => {
    const result = await createArchive({ bundleDir, outDir });
    expect(result.archiveName).toBe(DEFAULT_ARCHIVE_NAME);
    expect(result.archiveFileName).toBe(`${DEFAULT_ARCHIVE_NAME}.tar.gz`);
  });

  it('places all entries under the mcp-offline-bundle/ root', async () => {
    const result = await createArchive({ bundleDir, outDir, archiveName: 'b' });
    const entries = await listEntries(result.archivePath);
    expect(entries.length).toBeGreaterThan(0);
    for (const path of entries) {
      expect(path.startsWith(`${ARCHIVE_ROOT_DIR}/`)).toBe(true);
    }
    expect(entries).toContain(`${ARCHIVE_ROOT_DIR}/package.json`);
    expect(entries).toContain(`${ARCHIVE_ROOT_DIR}/README.md`);
    expect(entries).toContain(`${ARCHIVE_ROOT_DIR}/bin/alpha`);
  });
});
