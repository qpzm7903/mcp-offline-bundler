import type { Manifest, ServerConfig } from '../manifest/schema.js';

/**
 * Placeholder users must replace with the absolute path to the extracted
 * bundle directory. Documented in the generated README.
 */
export const BUNDLE_DIR_PLACEHOLDER = '__MCP_BUNDLE_DIR__';

/**
 * Build the command path used by all client configs for a given server.
 *
 * Always `__MCP_BUNDLE_DIR__/bin/{server.name}`, which the user replaces with
 * the real bundle directory after extraction.
 */
export function serverCommandPath(server: ServerConfig): string {
  return `${BUNDLE_DIR_PLACEHOLDER}/bin/${server.name}`;
}

/**
 * Shape of a single MCP server entry inside an `mcpServers` JSON object.
 */
export interface McpServerJson {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Build the `{ "mcpServers": { ... } }` object for the generic JSON config.
 *
 * Each server maps to its placeholder command path, the manifest `args`, and
 * the manifest `env`. Servers are emitted in manifest order.
 */
export function buildGenericJsonObject(manifest: Manifest): {
  mcpServers: Record<string, McpServerJson>;
} {
  const mcpServers: Record<string, McpServerJson> = {};
  for (const server of manifest.servers) {
    mcpServers[server.name] = {
      command: serverCommandPath(server),
      args: [...server.args],
      env: { ...server.env },
    };
  }
  return { mcpServers };
}

/**
 * Serialize the generic MCP JSON config to a stable string with trailing
 * newline.
 */
export function generateGenericJson(manifest: Manifest): string {
  return `${JSON.stringify(buildGenericJsonObject(manifest), null, 2)}\n`;
}
