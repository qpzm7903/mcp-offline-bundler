import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Manifest, ServerConfig } from '../manifest/schema.js';

/**
 * The fixed name of the generated runtime package.
 */
export const RUNTIME_PACKAGE_NAME = 'mcp-offline-bundle-runtime';

/**
 * Shape of the generated runtime package.json object.
 */
export interface RuntimePackageJson {
  name: typeof RUNTIME_PACKAGE_NAME;
  private: true;
  type: 'module';
  dependencies: Record<string, string>;
}

/**
 * Error thrown when a manifest would produce an invalid runtime package.json,
 * for example when two servers pin the same package to different versions.
 */
export class GeneratePackageJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeneratePackageJsonError';
  }
}

/**
 * Build the runtime package.json dependencies map from the manifest servers.
 *
 * Each server's `package` (including scoped packages such as `@scope/name`)
 * maps to that server's exact `version`. If two servers reference the same
 * package, they must pin the same version or this throws.
 */
export function buildDependencies(servers: readonly ServerConfig[]): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const server of servers) {
    const existing = dependencies[server.package];
    if (existing !== undefined && existing !== server.version) {
      throw new GeneratePackageJsonError(
        `Package "${server.package}" is pinned to conflicting versions ` +
          `"${existing}" and "${server.version}". Each package must use a single exact version.`,
      );
    }
    dependencies[server.package] = server.version;
  }
  return dependencies;
}

/**
 * Build the full runtime package.json object from a validated manifest.
 *
 * The output is always:
 * - name: mcp-offline-bundle-runtime
 * - private: true
 * - type: module
 * - dependencies: package -> exact version (scoped packages supported)
 */
export function generatePackageJson(manifest: Manifest): RuntimePackageJson {
  return {
    name: RUNTIME_PACKAGE_NAME,
    private: true,
    type: 'module',
    dependencies: buildDependencies(manifest.servers),
  };
}

/**
 * Serialize a runtime package.json object to a stable JSON string with a
 * trailing newline.
 */
export function serializePackageJson(pkg: RuntimePackageJson): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * Write the runtime package.json into the given working directory.
 *
 * Creates the directory (and parents) if needed. Returns the path written.
 *
 * @param workdir Directory in which to write package.json.
 * @param manifest Validated manifest used to build the package.
 * @returns Absolute or relative path to the written package.json file.
 */
export async function writePackageJson(workdir: string, manifest: Manifest): Promise<string> {
  const pkg = generatePackageJson(manifest);
  const outPath = join(workdir, 'package.json');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializePackageJson(pkg), 'utf8');
  return outPath;
}
