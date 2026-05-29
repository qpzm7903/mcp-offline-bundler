import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateManifest } from '../src/manifest/validateManifest.js';
import type { Manifest } from '../src/manifest/schema.js';
import {
  RUNTIME_PACKAGE_NAME,
  buildDependencies,
  generatePackageJson,
  serializePackageJson,
  writePackageJson,
  GeneratePackageJsonError,
} from '../src/build/generatePackageJson.js';

function manifestWith(servers: Array<Record<string, unknown>>): Manifest {
  return validateManifest({
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    servers,
  });
}

describe('generatePackageJson', () => {
  it('produces the fixed runtime package shape', () => {
    const manifest = manifestWith([
      { name: 'a', package: 'a', version: '1.0.0', bin: 'a' },
    ]);
    const pkg = generatePackageJson(manifest);
    expect(pkg.name).toBe(RUNTIME_PACKAGE_NAME);
    expect(pkg.name).toBe('mcp-offline-bundle-runtime');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toEqual({ a: '1.0.0' });
  });

  it('maps each server package to its exact version', () => {
    const manifest = manifestWith([
      { name: 'chrome-devtools', package: 'chrome-devtools-mcp', version: '0.18.1', bin: 'x' },
      { name: 'foo', package: 'foo-server', version: '2.3.4', bin: 'y' },
    ]);
    const pkg = generatePackageJson(manifest);
    expect(pkg.dependencies).toEqual({
      'chrome-devtools-mcp': '0.18.1',
      'foo-server': '2.3.4',
    });
  });

  it('handles scoped packages', () => {
    const manifest = manifestWith([
      { name: 'playwright', package: '@playwright/mcp', version: '0.0.75', bin: 'p' },
      { name: 'scoped', package: '@scope/some-server', version: '1.2.3-beta.1', bin: 's' },
    ]);
    const pkg = generatePackageJson(manifest);
    expect(pkg.dependencies).toEqual({
      '@playwright/mcp': '0.0.75',
      '@scope/some-server': '1.2.3-beta.1',
    });
  });

  it('collapses identical package+version into one dependency', () => {
    const manifest = manifestWith([
      { name: 'one', package: 'dup', version: '1.0.0', bin: 'a' },
      { name: 'two', package: 'dup', version: '1.0.0', bin: 'b' },
    ]);
    expect(generatePackageJson(manifest).dependencies).toEqual({ dup: '1.0.0' });
  });

  it('throws when the same package is pinned to conflicting versions', () => {
    const manifest = manifestWith([
      { name: 'one', package: 'dup', version: '1.0.0', bin: 'a' },
      { name: 'two', package: 'dup', version: '2.0.0', bin: 'b' },
    ]);
    expect(() => generatePackageJson(manifest)).toThrow(GeneratePackageJsonError);
  });
});

describe('buildDependencies', () => {
  it('returns an empty map for no servers', () => {
    expect(buildDependencies([])).toEqual({});
  });
});

describe('serializePackageJson', () => {
  it('produces pretty JSON with a trailing newline', () => {
    const manifest = manifestWith([{ name: 'a', package: 'a', version: '1.0.0', bin: 'a' }]);
    const text = serializePackageJson(generatePackageJson(manifest));
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      name: 'mcp-offline-bundle-runtime',
      private: true,
      type: 'module',
      dependencies: { a: '1.0.0' },
    });
  });
});

describe('writePackageJson', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mob-pkg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes package.json into the workdir, creating it if needed', async () => {
    const manifest = manifestWith([
      { name: 'playwright', package: '@playwright/mcp', version: '0.0.75', bin: 'p' },
    ]);
    const nested = join(dir, 'work', 'bundle');
    const outPath = await writePackageJson(nested, manifest);
    expect(outPath).toBe(join(nested, 'package.json'));
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written).toEqual({
      name: 'mcp-offline-bundle-runtime',
      private: true,
      type: 'module',
      dependencies: { '@playwright/mcp': '0.0.75' },
    });
  });
});
