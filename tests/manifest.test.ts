import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isExactVersion } from '../src/manifest/schema.js';
import { validateManifest, ManifestValidationError } from '../src/manifest/validateManifest.js';
import { loadManifest, ManifestLoadError } from '../src/manifest/loadManifest.js';

const validManifestYaml = `
bundle:
  name: browser-mcp-offline-bundle
  target: linux-x64
  node: ">=20"
  archiveName: mcp-offline-bundle-linux-x64

install:
  packageManager: npm
  omitDev: true
  env:
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"

servers:
  - name: chrome-devtools
    package: chrome-devtools-mcp
    version: "0.18.1"
    bin: chrome-devtools-mcp
    transport: stdio
    args:
      - "--browser-url=http://127.0.0.1:9222"
    env:
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1"
    smokeTestArgs:
      - "--help"

  - name: playwright
    package: "@playwright/mcp"
    version: "0.0.75"
    bin: playwright-mcp

clients:
  claudeDesktop: true
  codex: true
  cursor: true
  genericJson: true
`;

function baseManifest(): Record<string, unknown> {
  return {
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    servers: [{ name: 'a', package: 'a', version: '1.0.0', bin: 'a' }],
  };
}

describe('isExactVersion', () => {
  it('accepts exact versions', () => {
    for (const v of ['1.2.3', '0.0.75', '1.2.3-beta.1', '10.20.30', '1.2.3+build.5']) {
      expect(isExactVersion(v), v).toBe(true);
    }
  });

  it('rejects non-exact versions', () => {
    for (const v of [
      'latest',
      '*',
      '^1.2.3',
      '~1.2.3',
      '>=1.2.3',
      '<=1.2.3',
      '>1.2.3',
      '<1.2.3',
      '1.x',
      '1.2',
      '',
      ' 1.2.3',
      '1.2.3 ',
      '1.2.3 || 2.0.0',
    ]) {
      expect(isExactVersion(v), v).toBe(false);
    }
  });
});

describe('validateManifest', () => {
  it('accepts a minimal valid manifest and applies defaults', () => {
    const manifest = validateManifest(baseManifest());
    expect(manifest.servers).toHaveLength(1);
    const server = manifest.servers[0]!;
    expect(server.transport).toBe('stdio');
    expect(server.args).toEqual([]);
    expect(server.env).toEqual({});
    expect(server.smokeTestArgs).toEqual(['--help']);
    expect(manifest.clients.genericJson).toBe(true);
    expect(manifest.install.packageManager).toBe('npm');
  });

  it('rejects latest with an exact-version message', () => {
    const m = baseManifest();
    (m.servers as Array<Record<string, unknown>>)[0]!.version = 'latest';
    let err: ManifestValidationError | undefined;
    try {
      validateManifest(m);
    } catch (e) {
      err = e as ManifestValidationError;
    }
    expect(err).toBeInstanceOf(ManifestValidationError);
    expect(err!.issues.join('\n')).toMatch(/servers\[0\]\.version must be an exact version/);
  });

  it('rejects caret, tilde and range versions', () => {
    for (const v of ['^1.2.3', '~1.2.3', '>=1.2.3', '*']) {
      const m = baseManifest();
      (m.servers as Array<Record<string, unknown>>)[0]!.version = v;
      expect(() => validateManifest(m)).toThrow(ManifestValidationError);
    }
  });

  it('rejects duplicate server names', () => {
    const m = baseManifest();
    m.servers = [
      { name: 'dup', package: 'a', version: '1.0.0', bin: 'a' },
      { name: 'dup', package: 'b', version: '2.0.0', bin: 'b' },
    ];
    let err: ManifestValidationError | undefined;
    try {
      validateManifest(m);
    } catch (e) {
      err = e as ManifestValidationError;
    }
    expect(err).toBeInstanceOf(ManifestValidationError);
    expect(err!.issues.join('\n')).toMatch(/"dup" is duplicated/);
  });

  it('rejects an invalid bundle target', () => {
    const m = baseManifest();
    (m.bundle as Record<string, unknown>).target = 'windows-x64';
    expect(() => validateManifest(m)).toThrow(/target must be "linux-x64"/);
  });

  it('rejects a missing bundle.name', () => {
    const m = baseManifest();
    delete (m.bundle as Record<string, unknown>).name;
    expect(() => validateManifest(m)).toThrow(/bundle\.name/);
  });

  it('rejects a missing bundle.node', () => {
    const m = baseManifest();
    delete (m.bundle as Record<string, unknown>).node;
    expect(() => validateManifest(m)).toThrow(/bundle\.node/);
  });

  it('rejects an empty servers list', () => {
    const m = baseManifest();
    m.servers = [];
    expect(() => validateManifest(m)).toThrow(/at least one server/);
  });

  it('rejects a server name with invalid characters', () => {
    const m = baseManifest();
    (m.servers as Array<Record<string, unknown>>)[0]!.name = 'Bad_Name';
    expect(() => validateManifest(m)).toThrow(/must match \/\^\[a-z0-9-\]\+\$\//);
  });

  it('rejects a non-stdio transport', () => {
    const m = baseManifest();
    (m.servers as Array<Record<string, unknown>>)[0]!.transport = 'http';
    expect(() => validateManifest(m)).toThrow(/transport must be "stdio"/);
  });

  it('rejects non-string args entries', () => {
    const m = baseManifest();
    (m.servers as Array<Record<string, unknown>>)[0]!.args = [1, 2];
    expect(() => validateManifest(m)).toThrow(ManifestValidationError);
  });

  it('rejects unknown top-level keys', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).unexpected = true;
    expect(() => validateManifest(m)).toThrow(ManifestValidationError);
  });
});

describe('loadManifest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-manifest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a valid manifest from a YAML file', async () => {
    const file = join(dir, 'mcp.manifest.yaml');
    await writeFile(file, validManifestYaml, 'utf8');
    const manifest = await loadManifest(file);
    expect(manifest.bundle.name).toBe('browser-mcp-offline-bundle');
    expect(manifest.servers.map((s) => s.name)).toEqual(['chrome-devtools', 'playwright']);
    // Defaults applied to the second server which omitted optional fields.
    expect(manifest.servers[1]!.transport).toBe('stdio');
    expect(manifest.servers[1]!.smokeTestArgs).toEqual(['--help']);
  });

  it('throws ManifestLoadError for a missing file', async () => {
    await expect(loadManifest(join(dir, 'nope.yaml'))).rejects.toBeInstanceOf(ManifestLoadError);
  });

  it('throws ManifestLoadError for an empty file', async () => {
    const file = join(dir, 'empty.yaml');
    await writeFile(file, '', 'utf8');
    await expect(loadManifest(file)).rejects.toBeInstanceOf(ManifestLoadError);
  });

  it('throws ManifestValidationError for an invalid manifest file', async () => {
    const file = join(dir, 'bad.yaml');
    await writeFile(
      file,
      `bundle:\n  name: b\n  target: linux-x64\n  node: ">=20"\nservers:\n  - name: a\n    package: a\n    version: latest\n    bin: a\n`,
      'utf8',
    );
    await expect(loadManifest(file)).rejects.toBeInstanceOf(ManifestValidationError);
  });
});
