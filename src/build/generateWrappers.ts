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
 * Environment variable an MCP client can set to pass extra CLI arguments to a
 * server when the client forwards env vars but not argv (e.g. some stdio MCP
 * clients drop the configured `args`). The value is whitespace-split into
 * separate arguments.
 */
export const EXTRA_ARGS_ENV = 'MCP_BUNDLE_ARGS';

/**
 * Build the bash wrapper script content for a single server.
 *
 * The generated script:
 * - uses bash with `set -euo pipefail`
 * - resolves the bundle directory relative to the wrapper's own location, so
 *   `node_modules/.bin` is found at the bundle root regardless of cwd
 * - exports each `server.env` entry using `${VAR:-default}` so user-provided
 *   values win and defaults only apply when unset
 * - reads extra arguments from the `MCP_BUNDLE_ARGS` env var, for clients that
 *   forward env vars but not argv
 * - execs `node_modules/.bin/{server.bin}`, forwarding all user args; when the
 *   client passes no argv and sets no `MCP_BUNDLE_ARGS`, the manifest's
 *   configured `args` are applied as a fallback so the server still starts with
 *   a working configuration even if the client dropped them
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
  lines.push(`BIN="$BUNDLE_DIR/node_modules/.bin/${bin}"`);
  lines.push('');

  // Extra arguments from the environment, for MCP clients that forward env
  // vars but not CLI arguments. Whitespace-separated.
  lines.push(`# Extra arguments via the ${EXTRA_ARGS_ENV} env var, for MCP clients that forward`);
  lines.push('# env vars but not CLI arguments. Whitespace-separated, e.g.');
  lines.push(`# ${EXTRA_ARGS_ENV}="--browserUrl=http://127.0.0.1:9223".`);
  lines.push('declare -a ENV_ARGS=()');
  lines.push(`if [ -n "\${${EXTRA_ARGS_ENV}:-}" ]; then`);
  lines.push(`  read -r -a ENV_ARGS <<< "\${${EXTRA_ARGS_ENV}}"`);
  lines.push('fi');
  lines.push('');

  if (server.args.length > 0) {
    const quoted = server.args.map((arg) => `"${escapeForDoubleQuotes(arg)}"`).join(' ');
    lines.push('# Manifest-configured default arguments. Applied only when the wrapper is');
    lines.push(`# launched with no CLI args and no ${EXTRA_ARGS_ENV}, so MCP clients that drop`);
    lines.push('# configured args still start the server with a working configuration.');
    lines.push(`DEFAULT_ARGS=(${quoted})`);
    lines.push('');
    lines.push('if [ "$#" -gt 0 ] || [ "${#ENV_ARGS[@]}" -gt 0 ]; then');
    lines.push('  exec "$BIN" "${ENV_ARGS[@]}" "$@"');
    lines.push('fi');
    lines.push('exec "$BIN" "${DEFAULT_ARGS[@]}"');
  } else {
    lines.push('exec "$BIN" "${ENV_ARGS[@]}" "$@"');
  }
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
