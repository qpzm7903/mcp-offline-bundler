import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest } from '../manifest/schema.js';
import { generateGenericJson } from '../clients/genericJson.js';
import { generateClaudeDesktopJson } from '../clients/claudeDesktop.js';
import { generateCursorJson } from '../clients/cursorJson.js';
import { generateCodexToml } from '../clients/codexToml.js';

/**
 * Fixed config file names, relative to the bundle's `configs/` directory.
 */
export const CONFIG_FILES = {
  genericJson: 'generic-mcp.json',
  claudeDesktop: 'claude-desktop.json',
  codex: 'codex.toml',
  cursor: 'cursor.json',
} as const;

/**
 * A config file rendered in memory, ready to be written to `configs/`.
 */
export interface RenderedClientConfig {
  /** File name relative to the `configs/` directory. */
  file: string;
  /** Full file contents (with trailing newline). */
  content: string;
}

/**
 * Render every client config enabled in `manifest.clients`.
 *
 * Each enabled client maps its placeholder command path, args and env from the
 * manifest. Returns the rendered files in a stable order; disabled clients are
 * skipped.
 */
export function renderClientConfigs(manifest: Manifest): RenderedClientConfig[] {
  const rendered: RenderedClientConfig[] = [];
  if (manifest.clients.genericJson) {
    rendered.push({ file: CONFIG_FILES.genericJson, content: generateGenericJson(manifest) });
  }
  if (manifest.clients.claudeDesktop) {
    rendered.push({
      file: CONFIG_FILES.claudeDesktop,
      content: generateClaudeDesktopJson(manifest),
    });
  }
  if (manifest.clients.codex) {
    rendered.push({ file: CONFIG_FILES.codex, content: generateCodexToml(manifest) });
  }
  if (manifest.clients.cursor) {
    rendered.push({ file: CONFIG_FILES.cursor, content: generateCursorJson(manifest) });
  }
  return rendered;
}

/**
 * Result of writing a single client config to disk.
 */
export interface WrittenClientConfig {
  /** Config file name relative to `configs/`. */
  file: string;
  /** Path to the written config file. */
  path: string;
}

/**
 * Write all enabled client configs into `<bundleDir>/configs/`.
 *
 * Creates the `configs` directory if needed. Returns the written files in
 * stable order.
 *
 * @param bundleDir Bundle root directory; configs go in its `configs` subdir.
 * @param manifest Validated manifest driving config generation.
 */
export async function generateClientConfigs(
  bundleDir: string,
  manifest: Manifest,
): Promise<WrittenClientConfig[]> {
  const configsDir = join(bundleDir, 'configs');
  await mkdir(configsDir, { recursive: true });

  const written: WrittenClientConfig[] = [];
  for (const { file, content } of renderClientConfigs(manifest)) {
    const outPath = join(configsDir, file);
    await writeFile(outPath, content, 'utf8');
    written.push({ file, path: outPath });
  }
  return written;
}
