import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  writeSampleManifest,
  ManifestExistsError,
  SAMPLE_MANIFEST_CONTENT,
  DEFAULT_MANIFEST_FILENAME,
} from '../src/init/sampleManifest.js';
import { loadManifest } from '../src/manifest/loadManifest.js';
import { validateManifest } from '../src/manifest/validateManifest.js';
import { parse } from 'yaml';

describe('init: writeSampleManifest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-init-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the sample manifest to the given path', async () => {
    const target = join(dir, DEFAULT_MANIFEST_FILENAME);
    const result = await writeSampleManifest({ path: target });
    expect(result.path).toBe(target);
    const content = await readFile(target, 'utf8');
    expect(content).toBe(SAMPLE_MANIFEST_CONTENT);
  });

  it('refuses to overwrite an existing manifest unless forced', async () => {
    const target = join(dir, DEFAULT_MANIFEST_FILENAME);
    await writeFile(target, 'existing: true\n', 'utf8');

    await expect(writeSampleManifest({ path: target })).rejects.toBeInstanceOf(ManifestExistsError);
    // Original content untouched.
    expect(await readFile(target, 'utf8')).toBe('existing: true\n');

    // With force it overwrites.
    await writeSampleManifest({ path: target, force: true });
    expect(await readFile(target, 'utf8')).toBe(SAMPLE_MANIFEST_CONTENT);
  });

  it('produces a manifest that passes validation', async () => {
    const target = join(dir, DEFAULT_MANIFEST_FILENAME);
    await writeSampleManifest({ path: target });
    const manifest = await loadManifest(target);
    expect(manifest.bundle.target).toBe('linux-x64');
    expect(manifest.servers.length).toBeGreaterThanOrEqual(1);
  });

  it('sample content parses and validates with exact versions only', () => {
    const parsed = parse(SAMPLE_MANIFEST_CONTENT) as unknown;
    const manifest = validateManifest(parsed);
    for (const server of manifest.servers) {
      expect(server.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(server.version).not.toContain('^');
      expect(server.version).not.toContain('~');
      expect(server.version).not.toBe('latest');
    }
  });
});
