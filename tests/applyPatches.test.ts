import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateManifest } from '../src/manifest/validateManifest.js';
import type { Manifest } from '../src/manifest/schema.js';
import { ApplyPatchError, applyPatch, applyPatches } from '../src/build/applyPatches.js';

function manifestWithPatches(patches: Array<Record<string, unknown>>): Manifest {
  return validateManifest({
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    install: { patches },
    servers: [{ name: 'svc', package: 'svc-pkg', version: '1.0.0', bin: 'svc-bin' }],
  });
}

describe('applyPatch', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mob-patch-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePkgFile(pkg: string, file: string, content: string): Promise<void> {
    const full = join(dir, 'node_modules', pkg, file);
    await mkdir(join(dir, 'node_modules', pkg, file, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('replaces the find string in the target file', async () => {
    await writePkgFile('p', 'a.js', 'before return data.webSocketDebuggerUrl; after');
    const result = await applyPatch(dir, {
      package: 'p',
      file: 'a.js',
      find: 'return data.webSocketDebuggerUrl;',
      replace: 'return fixed;',
      count: 1,
    });
    expect(result).toEqual({ package: 'p', file: 'a.js', replacements: 1 });
    expect(await readFile(join(dir, 'node_modules', 'p', 'a.js'), 'utf8')).toBe(
      'before return fixed; after',
    );
  });

  it('throws when the target file does not exist', async () => {
    await expect(
      applyPatch(dir, { package: 'missing', file: 'x.js', find: 'a', replace: 'b' }),
    ).rejects.toThrow(ApplyPatchError);
  });

  it('throws when the find string is not present (version drift)', async () => {
    await writePkgFile('p', 'a.js', 'no match here');
    await expect(
      applyPatch(dir, { package: 'p', file: 'a.js', find: 'absent', replace: 'b' }),
    ).rejects.toThrow(/find string did not match/);
  });

  it('throws when the occurrence count does not match', async () => {
    await writePkgFile('p', 'a.js', 'x x');
    await expect(
      applyPatch(dir, { package: 'p', file: 'a.js', find: 'x', replace: 'y', count: 1 }),
    ).rejects.toThrow(/expected 1 occurrence/);
  });

  it('applyPatches applies every manifest patch in order', async () => {
    await writePkgFile('p', 'a.js', 'AAA');
    await writePkgFile('p', 'b.js', 'BBB');
    const manifest = manifestWithPatches([
      { package: 'p', file: 'a.js', find: 'AAA', replace: 'aaa' },
      { package: 'p', file: 'b.js', find: 'BBB', replace: 'bbb' },
    ]);
    const applied = await applyPatches(dir, manifest);
    expect(applied.map((a) => a.file)).toEqual(['a.js', 'b.js']);
    expect(await readFile(join(dir, 'node_modules', 'p', 'a.js'), 'utf8')).toBe('aaa');
    expect(await readFile(join(dir, 'node_modules', 'p', 'b.js'), 'utf8')).toBe('bbb');
  });

  it('applyPatches is a no-op when no patches are configured', async () => {
    const manifest = manifestWithPatches([]);
    expect(await applyPatches(dir, manifest)).toEqual([]);
  });
});

describe('schema: install.patches', () => {
  it('defaults to an empty array', () => {
    const m = validateManifest({
      bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
      servers: [{ name: 's', package: 'p', version: '1.0.0', bin: 'b' }],
    });
    expect(m.install.patches).toEqual([]);
  });

  it('rejects a patch missing required fields', () => {
    expect(() =>
      validateManifest({
        bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
        install: { patches: [{ package: 'p' }] },
        servers: [{ name: 's', package: 'p', version: '1.0.0', bin: 'b' }],
      }),
    ).toThrow();
  });
});

describe('chrome-devtools getWSEndpoint patch semantics', () => {
  // Mirrors the replacement expression shipped in the example manifest: rewrite
  // the WebSocket URL host:port to the endpoint the user actually provided.
  function rewrite(browserURL: string, wsUrl: string): string {
    try {
      const u = new URL(browserURL);
      const w = new URL(wsUrl);
      w.host = u.host;
      return w.toString();
    } catch {
      return wsUrl;
    }
  }

  it('injects the missing port from the browserUrl', () => {
    expect(rewrite('http://127.0.0.1:9223', 'ws://172.19.144.1/devtools/browser/abc')).toBe(
      'ws://127.0.0.1:9223/devtools/browser/abc',
    );
  });

  it('rewrites a mismatched host:port to the user-provided endpoint', () => {
    expect(rewrite('http://10.0.0.5:9222', 'ws://172.19.144.1:1/devtools/browser/xyz')).toBe(
      'ws://10.0.0.5:9222/devtools/browser/xyz',
    );
  });

  it('leaves the path/browser id untouched', () => {
    expect(rewrite('http://h:9222', 'ws://other/devtools/browser/keep-me')).toBe(
      'ws://h:9222/devtools/browser/keep-me',
    );
  });
});
