import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateManifest } from '../src/manifest/validateManifest.js';
import type { Manifest } from '../src/manifest/schema.js';
import {
  BUNDLE_DIR_PLACEHOLDER,
  buildGenericJsonObject,
  generateGenericJson,
  serverCommandPath,
} from '../src/clients/genericJson.js';
import { generateClaudeDesktopJson } from '../src/clients/claudeDesktop.js';
import { generateCursorJson } from '../src/clients/cursorJson.js';
import { generateCodexToml, tomlKey, tomlString } from '../src/clients/codexToml.js';
import {
  CONFIG_FILES,
  generateClientConfigs,
  renderClientConfigs,
} from '../src/build/generateClientConfigs.js';

function manifestWith(
  servers: Array<Record<string, unknown>>,
  clients?: Record<string, unknown>,
): Manifest {
  return validateManifest({
    bundle: { name: 'b', target: 'linux-x64', node: '>=20' },
    servers,
    ...(clients ? { clients } : {}),
  });
}

const twoServers = [
  {
    name: 'chrome-devtools',
    package: 'chrome-devtools-mcp',
    version: '0.18.1',
    bin: 'chrome-devtools-mcp',
    args: ['--browser-url=http://127.0.0.1:9222', '--no-usage-statistics'],
    env: { CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' },
  },
  {
    name: 'playwright',
    package: '@playwright/mcp',
    version: '0.0.75',
    bin: 'playwright-mcp',
    args: ['--cdp-endpoint=http://127.0.0.1:9222'],
    env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  },
];

describe('generic JSON config', () => {
  it('places all servers under mcpServers with placeholder command paths', () => {
    const manifest = manifestWith(twoServers);
    const obj = buildGenericJsonObject(manifest);
    expect(Object.keys(obj.mcpServers)).toEqual(['chrome-devtools', 'playwright']);
    expect(obj.mcpServers['chrome-devtools'].command).toBe(
      '__MCP_BUNDLE_DIR__/bin/chrome-devtools',
    );
    expect(obj.mcpServers.playwright.command).toBe('__MCP_BUNDLE_DIR__/bin/playwright');
  });

  it('includes args and env from the manifest', () => {
    const obj = buildGenericJsonObject(manifestWith(twoServers));
    expect(obj.mcpServers['chrome-devtools'].args).toEqual([
      '--browser-url=http://127.0.0.1:9222',
      '--no-usage-statistics',
    ]);
    expect(obj.mcpServers['chrome-devtools'].env).toEqual({
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    });
  });

  it('produces valid, parseable JSON with a trailing newline', () => {
    const text = generateGenericJson(manifestWith(twoServers));
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual(buildGenericJsonObject(manifestWith(twoServers)));
  });

  it('serverCommandPath uses the placeholder', () => {
    const server = manifestWith(twoServers).servers[0];
    expect(serverCommandPath(server)).toBe(`${BUNDLE_DIR_PLACEHOLDER}/bin/chrome-devtools`);
  });

  it('emits empty args/env objects when absent', () => {
    const obj = buildGenericJsonObject(
      manifestWith([{ name: 'svc', package: 'p', version: '1.0.0', bin: 'b' }]),
    );
    expect(obj.mcpServers.svc.args).toEqual([]);
    expect(obj.mcpServers.svc.env).toEqual({});
  });
});

describe('claude desktop and cursor JSON configs', () => {
  it('produce the same mcpServers JSON shape as generic', () => {
    const manifest = manifestWith(twoServers);
    const generic = generateGenericJson(manifest);
    expect(generateClaudeDesktopJson(manifest)).toBe(generic);
    expect(generateCursorJson(manifest)).toBe(generic);
    expect(() => JSON.parse(generateClaudeDesktopJson(manifest))).not.toThrow();
    expect(() => JSON.parse(generateCursorJson(manifest))).not.toThrow();
  });
});

describe('codex TOML config', () => {
  it('emits a table per server with command, args and env table', () => {
    const toml = generateCodexToml(manifestWith(twoServers));
    expect(toml).toContain('[mcp_servers.chrome-devtools]');
    expect(toml).toContain('command = "__MCP_BUNDLE_DIR__/bin/chrome-devtools"');
    expect(toml).toContain('[mcp_servers.chrome-devtools.env]');
    expect(toml).toContain('CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = "1"');
    expect(toml).toContain('[mcp_servers.playwright]');
    expect(toml).toContain('command = "__MCP_BUNDLE_DIR__/bin/playwright"');
    expect(toml.endsWith('\n')).toBe(true);
  });

  it('renders the args array deterministically', () => {
    const toml = generateCodexToml(manifestWith(twoServers));
    expect(toml).toContain(
      [
        'args = [',
        '  "--browser-url=http://127.0.0.1:9222",',
        '  "--no-usage-statistics"',
        ']',
      ].join('\n'),
    );
  });

  it('is byte-for-byte stable across calls', () => {
    const manifest = manifestWith(twoServers);
    expect(generateCodexToml(manifest)).toBe(generateCodexToml(manifest));
  });

  it('omits the env table when a server has no env', () => {
    const toml = generateCodexToml(
      manifestWith([{ name: 'svc', package: 'p', version: '1.0.0', bin: 'b' }]),
    );
    expect(toml).toContain('[mcp_servers.svc]');
    expect(toml).not.toContain('[mcp_servers.svc.env]');
    expect(toml).toContain('args = []');
  });

  it('escapes special characters in TOML strings', () => {
    expect(tomlString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(tomlString('line\nbreak')).toBe('"line\\nbreak"');
  });

  it('quotes non-bare keys', () => {
    expect(tomlKey('bare-key_1')).toBe('bare-key_1');
    expect(tomlKey('has space')).toBe('"has space"');
  });
});

describe('renderClientConfigs', () => {
  it('renders all four configs when all clients are enabled', () => {
    const rendered = renderClientConfigs(manifestWith(twoServers));
    expect(rendered.map((r) => r.file)).toEqual([
      CONFIG_FILES.genericJson,
      CONFIG_FILES.claudeDesktop,
      CONFIG_FILES.codex,
      CONFIG_FILES.cursor,
    ]);
  });

  it('skips clients disabled in the manifest', () => {
    const manifest = manifestWith(twoServers, {
      genericJson: true,
      claudeDesktop: false,
      codex: false,
      cursor: false,
    });
    expect(renderClientConfigs(manifest).map((r) => r.file)).toEqual([CONFIG_FILES.genericJson]);
  });
});

describe('generateClientConfigs (filesystem)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mob-cfg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes all enabled config files under configs/', async () => {
    const manifest = manifestWith(twoServers);
    const written = await generateClientConfigs(dir, manifest);
    expect(written.map((w) => w.file)).toEqual([
      'generic-mcp.json',
      'claude-desktop.json',
      'codex.toml',
      'cursor.json',
    ]);

    const files = (await readdir(join(dir, 'configs'))).sort();
    expect(files).toEqual(
      ['generic-mcp.json', 'claude-desktop.json', 'codex.toml', 'cursor.json'].sort(),
    );

    const generic = await readFile(join(dir, 'configs', 'generic-mcp.json'), 'utf8');
    expect(JSON.parse(generic).mcpServers['chrome-devtools'].command).toBe(
      '__MCP_BUNDLE_DIR__/bin/chrome-devtools',
    );

    const toml = await readFile(join(dir, 'configs', 'codex.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.playwright]');
  });
});
