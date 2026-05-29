import type { Manifest, ServerConfig } from '../manifest/schema.js';
import { serverCommandPath } from './genericJson.js';

/**
 * Serialize a string as a TOML basic string.
 *
 * Escapes backslash, double quote and the control characters TOML requires to
 * be escaped (backspace, tab, newline, form feed, carriage return). Other
 * control characters are emitted as `\uXXXX`.
 */
export function tomlString(value: string): string {
  let out = '"';
  for (const char of value) {
    switch (char) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\r':
        out += '\\r';
        break;
      default: {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) {
          out += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
        } else {
          out += char;
        }
      }
    }
  }
  out += '"';
  return out;
}

/**
 * Serialize a TOML bare/quoted key.
 *
 * Bare keys (letters, digits, underscore, hyphen) are emitted as-is; anything
 * else is quoted as a basic string.
 */
export function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlStringArray(values: readonly string[]): string {
  if (values.length === 0) {
    return '[]';
  }
  const items = values.map((value) => `  ${tomlString(value)}`).join(',\n');
  return `[\n${items}\n]`;
}

function serverTable(server: ServerConfig): string {
  const name = tomlKey(server.name);
  const lines: string[] = [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(serverCommandPath(server))}`,
    `args = ${tomlStringArray(server.args)}`,
  ];

  const envKeys = Object.keys(server.env);
  if (envKeys.length > 0) {
    lines.push('');
    lines.push(`[mcp_servers.${name}.env]`);
    for (const key of envKeys) {
      lines.push(`${tomlKey(key)} = ${tomlString(server.env[key] ?? '')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate the Codex `codex.toml` config fragment.
 *
 * Emits one `[mcp_servers.<name>]` table per server (in manifest order) with a
 * `command` placeholder path, an `args` array, and a nested
 * `[mcp_servers.<name>.env]` table when env vars are present. Output is
 * deterministic and ends with a trailing newline.
 */
export function generateCodexToml(manifest: Manifest): string {
  const tables = manifest.servers.map(serverTable);
  return `${tables.join('\n\n')}\n`;
}
