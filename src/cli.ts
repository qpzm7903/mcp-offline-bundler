#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createProgram } from './index.js';
import { ManifestLoadError } from './manifest/loadManifest.js';
import { ManifestValidationError } from './manifest/validateManifest.js';
import { PackBundleError } from './build/packBundle.js';
import { ManifestExistsError } from './init/sampleManifest.js';

/**
 * Run the CLI against the given argv. Errors are written to stderr only.
 */
export async function run(argv: readonly string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync([...argv]);
  } catch (error: unknown) {
    // These errors are already reported to stderr by their command handler;
    // avoid printing them twice. Set a non-zero exit code regardless.
    const alreadyReported =
      error instanceof ManifestValidationError ||
      error instanceof ManifestLoadError ||
      error instanceof PackBundleError ||
      error instanceof ManifestExistsError;
    if (!alreadyReported) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
}

// Only auto-run when invoked directly as the CLI entrypoint, not when imported.
const invokedDirectly =
  typeof process.argv[1] === 'string' && process.argv[1] === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void run();
}
