import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateManifest } from '../src/manifest/validateManifest.js';
import type { Manifest, ServerConfig } from '../src/manifest/schema.js';
import {
  WRAPPER_MODE,
  generateWrapperScript,
  generateWrappers,
  writeWrapper,
} from '../src/build/generateWrappers.js';

function manifestWith(servers: Array<Record<string, unknown>>): Manifest {
  return validateManifest({
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    servers,
  });
}

function serverWith(overrides: Record<string, unknown>): ServerConfig {
  return manifestWith([
    { name: 'svc', package: 'svc-pkg', version: '1.0.0', bin: 'svc-bin', ...overrides },
  ]).servers[0];
}

describe('generateWrapperScript', () => {
  it('produces a deterministic bash wrapper with no env', () => {
    const server = serverWith({ name: 'plain', bin: 'plain-bin' });
    expect(generateWrapperScript(server)).toBe(
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        '# Resolve the bundle root relative to this wrapper so node_modules/.bin',
        '# resolves regardless of the current working directory.',
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"',
        '',
        'exec "$BUNDLE_DIR/node_modules/.bin/plain-bin" "$@"',
        '',
      ].join('\n'),
    );
  });

  it('is byte-for-byte stable across calls', () => {
    const server = serverWith({ env: { B: '2', A: '1' } });
    expect(generateWrapperScript(server)).toBe(generateWrapperScript(server));
  });

  it('begins with a bash shebang and strict mode', () => {
    const script = generateWrapperScript(serverWith({}));
    const lines = script.split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines[1]).toBe('set -euo pipefail');
  });

  it('exports env defaults using ${VAR:-default} with sorted keys', () => {
    const server = serverWith({ env: { ZED: 'last', ALPHA: 'first' } });
    const script = generateWrapperScript(server);
    expect(script).toContain('export ALPHA="${ALPHA:-first}"');
    expect(script).toContain('export ZED="${ZED:-last}"');
    // sorted: ALPHA before ZED
    expect(script.indexOf('ALPHA')).toBeLessThan(script.indexOf('ZED'));
  });

  it('execs node_modules/.bin/{bin} relative to the bundle dir and forwards args', () => {
    const script = generateWrapperScript(serverWith({ bin: 'my-bin' }));
    expect(script).toContain('exec "$BUNDLE_DIR/node_modules/.bin/my-bin" "$@"');
  });

  it('escapes shell metacharacters in env default values', () => {
    const server = serverWith({ env: { TOKEN: 'a"b$c`d\\e' } });
    const script = generateWrapperScript(server);
    expect(script).toContain('export TOKEN="${TOKEN:-a\\"b\\$c\\`d\\\\e}"');
  });

  it('does not write informational logs to stdout (no echo/printf statements)', () => {
    const server = serverWith({ env: { A: '1' } });
    const script = generateWrapperScript(server);
    expect(script).not.toMatch(/\becho\b/);
    expect(script).not.toMatch(/\bprintf\b/);
  });

  it('ends with a trailing newline', () => {
    expect(generateWrapperScript(serverWith({})).endsWith('\n')).toBe(true);
  });
});

describe('writeWrapper / generateWrappers', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mob-wrap-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes an executable wrapper into bin/{name}', async () => {
    const server = serverWith({ name: 'chrome-devtools', bin: 'chrome-devtools-mcp' });
    const result = await writeWrapper(dir, server);
    expect(result).toEqual({ server: 'chrome-devtools', path: join(dir, 'bin', 'chrome-devtools') });

    const content = await readFile(result.path, 'utf8');
    expect(content).toBe(generateWrapperScript(server));

    const info = await stat(result.path);
    // Executable bits set for owner/group/other.
    expect(info.mode & 0o111).not.toBe(0);
    expect(info.mode & 0o777).toBe(WRAPPER_MODE);
  });

  it('generates a wrapper per server in manifest order', async () => {
    const manifest = manifestWith([
      { name: 'one', package: 'p1', version: '1.0.0', bin: 'b1' },
      { name: 'two', package: 'p2', version: '2.0.0', bin: 'b2' },
    ]);
    const written = await generateWrappers(dir, manifest);
    expect(written.map((w) => w.server)).toEqual(['one', 'two']);

    const one = await readFile(join(dir, 'bin', 'one'), 'utf8');
    const two = await readFile(join(dir, 'bin', 'two'), 'utf8');
    expect(one).toContain('node_modules/.bin/b1');
    expect(two).toContain('node_modules/.bin/b2');
  });
});
