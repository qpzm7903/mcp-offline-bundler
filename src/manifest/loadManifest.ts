import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { validateManifest } from './validateManifest.js';
import type { Manifest } from './schema.js';

/**
 * Error thrown when a manifest file cannot be read or parsed (as opposed to
 * a structural validation failure, which throws ManifestValidationError).
 */
export class ManifestLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ManifestLoadError';
  }
}

/**
 * Parse YAML text into an unknown object. Wraps parse errors with an
 * actionable message that names the manifest path.
 */
export function parseManifestYaml(text: string, sourcePath: string): unknown {
  try {
    return parseYaml(text);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ManifestLoadError(`Failed to parse YAML in ${sourcePath}: ${detail}`, {
      cause: error,
    });
  }
}

/**
 * Read, parse and validate a manifest file from disk.
 *
 * @param path Path to the manifest YAML file.
 * @returns The validated manifest with defaults applied.
 * @throws ManifestLoadError when the file cannot be read or parsed.
 * @throws ManifestValidationError when the manifest is structurally invalid.
 */
export async function loadManifest(path: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ManifestLoadError(`Failed to read manifest file ${path}: ${detail}`, {
      cause: error,
    });
  }

  const raw = parseManifestYaml(text, path);
  if (raw === null || raw === undefined) {
    throw new ManifestLoadError(
      `Manifest file ${path} is empty; expected a YAML document with "bundle" and "servers".`,
    );
  }

  return validateManifest(raw);
}
