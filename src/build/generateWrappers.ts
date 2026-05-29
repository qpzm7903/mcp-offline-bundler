import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, ServerConfig } from '../manifest/schema.js';

/**
 * Octal file mode for generated wrapper scripts: rwxr-xr-x.
 */
export const WRAPPER_MODE = 0o755;

/**
 * Quote a string for safe use inside a double-quoted bash context.
 *
 * Escapes the characters that are still special inside double quotes:
 * backslash, double quote, dollar sign and backtick. This keeps env default
 * values literal so they cannot inject shell expansion.
 */
function escapeForDoubleQuotes(value: string): string {
  return value.replace(/[\\"$`]/g, (char) => `\\${char}`);
}

/**
 * Build the bash wrapper script content for a single server.
 *
 * The generated script:
 * - uses bash with `set -euo pipefail`
 * - resolves the bundle directory relative to the wrapper's own location, so
 *   `node_modules/.bin` is found at the bundle root regardless of cwd
 * - exports each `server.env` entry using `${VAR:-default}` so user-provided
 *   values win and defaults only apply when unset
 * - execs `node_modules/.bin/{server.bin}` forwarding all user args
 *
 * The wrapper never writes informational logs to stdout; only the executed
 * MCP server speaks on stdout.
 *
 * @param server Validated server entry (defaults already applied).
 * @returns Deterministic wrapper script text ending with a trailing newline.
 */
export function generateWrapperScript(server: ServerConfig): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Resolve the bundle root relative to this wrapper so node_modules/.bin',
    '# resolves regardless of the current working directory.',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'BUNDLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"',
    '',
  ];

  const envKeys = Object.keys(server.env).sort();
  if (envKeys.length > 0) {
    lines.push('# Default environment values; user-provided values take precedence.');
    for (const key of envKeys) {
      const value = escapeForDoubleQuotes(server.env[key] ?? '');
      lines.push(`export ${key}="\${${key}:-${value}}"`);
    }
    lines.push('');
  }

  const bin = escapeForDoubleQuotes(server.bin);
  lines.push(`exec "$BUNDLE_DIR/node_modules/.bin/${bin}" "$@"`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Result of writing a single wrapper to disk.
 */
export interface WrittenWrapper {
  /** Server name the wrapper was generated for. */
  server: string;
  /** Absolute or relative path to the written wrapper file. */
  path: string;
}

/**
 * Write the bash wrapper for a single server into `<bundleDir>/bin/{name}`.
 *
 * Creates the `bin` directory if needed and marks the wrapper executable.
 */
export async function writeWrapper(
  bundleDir: string,
  server: ServerConfig,
): Promise<WrittenWrapper> {
  const binDir = join(bundleDir, 'bin');
  await mkdir(binDir, { recursive: true });
  const outPath = join(binDir, server.name);
  await writeFile(outPath, generateWrapperScript(server), 'utf8');
  await chmod(outPath, WRAPPER_MODE);
  return { server: server.name, path: outPath };
}

/**
 * Generate executable bash wrappers for every server in the manifest under
 * `<bundleDir>/bin/`.
 *
 * @param bundleDir Bundle root directory; wrappers go in its `bin` subdir.
 * @param manifest Validated manifest whose servers drive wrapper generation.
 * @returns The list of written wrappers in manifest order.
 */
export async function generateWrappers(
  bundleDir: string,
  manifest: Manifest,
): Promise<WrittenWrapper[]> {
  const written: WrittenWrapper[] = [];
  for (const server of manifest.servers) {
    written.push(await writeWrapper(bundleDir, server));
  }
  return written;
}
