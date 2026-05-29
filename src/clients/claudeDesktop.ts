import type { Manifest } from '../manifest/schema.js';
import { buildGenericJsonObject } from './genericJson.js';

/**
 * Generate the Claude Desktop config fragment.
 *
 * Claude Desktop uses the same `{ "mcpServers": { ... } }` JSON shape as the
 * generic config: command points at the placeholder bundle path and args/env
 * come from the manifest. Returns a stable string with a trailing newline.
 */
export function generateClaudeDesktopJson(manifest: Manifest): string {
  return `${JSON.stringify(buildGenericJsonObject(manifest), null, 2)}\n`;
}
