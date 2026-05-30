import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest } from '../manifest/schema.js';
import { BUNDLE_DIR_PLACEHOLDER } from '../clients/genericJson.js';
import { CONFIG_FILES } from './generateClientConfigs.js';

/**
 * Render a markdown table row listing a single server's package and version.
 */
function serverRow(server: Manifest['servers'][number]): string {
  return `| ${server.name} | \`${server.package}\` | ${server.version} | \`bin/${server.name}\` |`;
}

/**
 * Build the bundle README markdown content from a validated manifest.
 *
 * Covers the items required by the PRD (section 9.10): package name, target
 * platform, Node.js requirement, server list, extraction command, client
 * configuration instructions, Windows Chrome remote-debugging example, WSL
 * troubleshooting, security notes, checksum verification, and an FAQ.
 *
 * @param manifest Validated manifest driving the README content.
 * @returns Deterministic markdown text ending with a trailing newline.
 */
export function generateReadme(manifest: Manifest): string {
  const { bundle, servers, clients } = manifest;
  const archiveName = bundle.archiveName ?? 'mcp-offline-bundle-linux-x64';

  const serverTable = [
    '| Name | Package | Version | Wrapper |',
    '| --- | --- | --- | --- |',
    ...servers.map(serverRow),
  ].join('\n');

  const enabledConfigs: string[] = [];
  if (clients.genericJson) {
    enabledConfigs.push(`- \`configs/${CONFIG_FILES.genericJson}\` — generic MCP JSON config`);
  }
  if (clients.claudeDesktop) {
    enabledConfigs.push(`- \`configs/${CONFIG_FILES.claudeDesktop}\` — Claude Desktop config`);
  }
  if (clients.codex) {
    enabledConfigs.push(`- \`configs/${CONFIG_FILES.codex}\` — Codex config`);
  }
  if (clients.cursor) {
    enabledConfigs.push(`- \`configs/${CONFIG_FILES.cursor}\` — Cursor config`);
  }
  const configList = enabledConfigs.length > 0 ? enabledConfigs.join('\n') : '- (no client configs enabled)';

  const lines: string[] = [
    `# ${bundle.name}`,
    '',
    'Offline runtime bundle for npm-based MCP servers.',
    '',
    '## Bundle information',
    '',
    `- Target platform: \`${bundle.target}\``,
    `- Node.js requirement: \`${bundle.node}\``,
    `- Archive name: \`${archiveName}.tar.gz\``,
    '',
    'This bundle is built for **linux-x64** only (WSL2 / Linux). It is not',
    'supported on Windows or macOS hosts directly.',
    '',
    '## Included MCP servers',
    '',
    serverTable,
    '',
    '## Extract the bundle',
    '',
    '```bash',
    `tar -xzf ${archiveName}.tar.gz -C ~/tools`,
    '```',
    '',
    'After extraction the bundle root is `~/tools/mcp-offline-bundle/`. Use that',
    'absolute path wherever the configs below show the placeholder',
    `\`${BUNDLE_DIR_PLACEHOLDER}\`.`,
    '',
    '## Configure your MCP client',
    '',
    'Generated client config snippets live under `configs/`:',
    '',
    configList,
    '',
    `Each config uses the placeholder \`${BUNDLE_DIR_PLACEHOLDER}/bin/<server>\` as the`,
    'command path. Replace `' + BUNDLE_DIR_PLACEHOLDER + '` with the absolute path to',
    'the extracted bundle directory (for example',
    '`/home/yourname/tools/mcp-offline-bundle`), then copy the snippet into your',
    'MCP client configuration file. This tool never edits your client config',
    'files in place.',
    '',
    '## Windows Chrome remote debugging',
    '',
    'When using browser MCP servers from WSL against a Chrome instance on the',
    'Windows host, start Chrome with remote debugging enabled (use a dedicated,',
    'throwaway profile):',
    '',
    '```powershell',
    '& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" `',
    '  --remote-debugging-port=9222 `',
    '  --user-data-dir="C:\\chrome-debug-profile"',
    '```',
    '',
    '## WSL to Windows Chrome troubleshooting',
    '',
    'If a server cannot reach `http://127.0.0.1:9222` from inside WSL:',
    '',
    '1. Confirm Chrome is running with `--remote-debugging-port=9222` on Windows.',
    '2. From WSL, try `curl http://127.0.0.1:9222/json/version`.',
    '3. If that fails, find the Windows host IP with',
    '   `cat /etc/resolv.conf` (the `nameserver` line) and target that IP',
    '   instead of `127.0.0.1`, adjusting the server `--browserUrl` /',
    '   `--cdp-endpoint` argument accordingly.',
    '4. Ensure no Windows firewall rule blocks the debugging port.',
    '',
    '## Security notes',
    '',
    '- Run Chrome remote debugging with a **separate, dedicated profile**.',
    '- Do not log into sensitive accounts in that Chrome profile.',
    '- Do not open company-internal systems or private pages while debugging.',
    '- Only enable remote debugging on a trusted local machine or trusted',
    '  network.',
    '- Close the remote-debugging Chrome instance when you are finished.',
    '',
    '## Verify the checksum',
    '',
    'Verify the archive integrity before extracting:',
    '',
    '```bash',
    'sha256sum -c checksums.txt',
    '```',
    '',
    '## FAQ',
    '',
    '**Does this bundle download a browser?**',
    'No. Browser binaries are never bundled or downloaded; Playwright browser',
    'downloads are skipped via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.',
    '',
    '**Can I run this on Windows or macOS directly?**',
    'No. The MVP supports `linux-x64` only. Use WSL2 on Windows.',
    '',
    '**Do I need network access to use the bundle?**',
    'No. All npm dependencies are vendored under `node_modules/`. The bundle is',
    'designed for offline use.',
    '',
    '**Why is the command path a placeholder?**',
    `The bundle does not know where you will extract it, so configs ship with the`,
    `\`${BUNDLE_DIR_PLACEHOLDER}\` placeholder for you to replace.`,
    '',
    '**My MCP client ignores the configured `args` (the server starts unconfigured).**',
    'Some clients forward env vars but not CLI arguments. The wrappers under',
    '`bin/` accept extra arguments via the `MCP_BUNDLE_ARGS` environment variable',
    '(whitespace-separated), and fall back to the manifest-configured arguments',
    'when launched with no arguments. For example, set',
    '`MCP_BUNDLE_ARGS="--browserUrl=http://127.0.0.1:9222"` in the client `env`.',
    '',
    '**`--browserUrl` connects but every operation hangs.**',
    'The upstream `/json/version` response may omit the host/port from',
    '`webSocketDebuggerUrl` (common behind a proxy or with WSL2 host IPs). Pass',
    'the full WebSocket endpoint instead, e.g.',
    '`--wsEndpoint=ws://<host>:<port>/devtools/browser/<id>`.',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

/**
 * Write the bundle README into `<bundleDir>/README.md`.
 *
 * Creates the bundle directory if needed. Returns the path written.
 *
 * @param bundleDir Bundle root directory.
 * @param manifest Validated manifest driving the README content.
 * @returns Path to the written README.md file.
 */
export async function writeReadme(bundleDir: string, manifest: Manifest): Promise<string> {
  await mkdir(bundleDir, { recursive: true });
  const outPath = join(bundleDir, 'README.md');
  await writeFile(outPath, generateReadme(manifest), 'utf8');
  return outPath;
}
