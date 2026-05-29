import { Command } from 'commander';
import { loadManifest, ManifestLoadError } from './manifest/loadManifest.js';
import { ManifestValidationError } from './manifest/validateManifest.js';
import { buildBundle } from './build/buildBundle.js';
import { packBundle, PackBundleError } from './build/packBundle.js';
import { generateGenericJson } from './clients/genericJson.js';
import { generateClaudeDesktopJson } from './clients/claudeDesktop.js';
import { generateCursorJson } from './clients/cursorJson.js';
import { generateCodexToml } from './clients/codexToml.js';
import {
  writeSampleManifest,
  ManifestExistsError,
  DEFAULT_MANIFEST_FILENAME,
} from './init/sampleManifest.js';
import type { Manifest } from './manifest/schema.js';

/**
 * The CLI program name as exposed to users.
 */
export const CLI_NAME = 'mcp-offline-bundler';

/**
 * The CLI version. Kept in sync with package.json during release.
 */
export const VERSION = '0.0.0';

/**
 * Build the commander program with all subcommands wired up.
 *
 * Phase 0 only provides stub subcommands. Later phases replace the action
 * handlers with real implementations (manifest validation, build, pack, etc.).
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description('Build offline runtime bundles for npm-based MCP servers (linux-x64).')
    .version(VERSION);

  program
    .command('init')
    .description('Generate an example mcp.manifest.yaml in the current directory.')
    .option('--path <path>', 'destination manifest path', DEFAULT_MANIFEST_FILENAME)
    .option('--force', 'overwrite an existing manifest file', false)
    .action(async (options: { path: string; force: boolean }) => {
      await runInit(options.path, options.force);
    });

  program
    .command('validate')
    .description('Validate a manifest file without installing dependencies.')
    .requiredOption('-m, --manifest <path>', 'path to the manifest file')
    .action(async (options: { manifest: string }) => {
      await runValidate(options.manifest);
    });

  program
    .command('build')
    .description('Run the full offline bundle build pipeline.')
    .requiredOption('-m, --manifest <path>', 'path to the manifest file')
    .option('--out <dir>', 'output directory', 'dist')
    .option('--skip-install', 'skip npm install and smoke tests (offline layout only)', false)
    .option('--skip-smoke-tests', 'install dependencies but skip smoke tests', false)
    .action(
      async (options: {
        manifest: string;
        out: string;
        skipInstall: boolean;
        skipSmokeTests: boolean;
      }) => {
        await runBuild(options.manifest, options.out, {
          skipInstall: options.skipInstall,
          skipSmokeTests: options.skipSmokeTests,
        });
      },
    );

  program
    .command('pack')
    .description('Create a tar.gz archive from an existing bundle workdir.')
    .requiredOption('--workdir <dir>', 'path to the prepared bundle workdir')
    .option('--out <dir>', 'output directory', 'dist')
    .action(async (options: { workdir: string; out: string }) => {
      await runPack(options.workdir, options.out);
    });

  program
    .command('print-config')
    .description('Print a generated client config to stdout.')
    .requiredOption('-m, --manifest <path>', 'path to the manifest file')
    .option('--client <client>', 'target client', 'generic')
    .action(async (options: { manifest: string; client: string }) => {
      await runPrintConfig(options.manifest, options.client);
    });

  return program;
}

/**
 * Supported `print-config --client` values mapped to their renderers.
 */
const PRINT_CONFIG_RENDERERS: Record<string, (manifest: Manifest) => string> = {
  generic: generateGenericJson,
  'claude-desktop': generateClaudeDesktopJson,
  codex: generateCodexToml,
  cursor: generateCursorJson,
};

/**
 * The list of accepted `--client` values, for error messages.
 */
export const PRINT_CONFIG_CLIENTS = Object.keys(PRINT_CONFIG_RENDERERS);

/**
 * Generate a sample manifest file (PRD section 10.1). On success, print a short
 * confirmation to stdout. On failure (e.g. the file already exists), print an
 * actionable error to stderr, set a non-zero exit code, and rethrow.
 */
export async function runInit(path: string, force: boolean): Promise<void> {
  try {
    const result = await writeSampleManifest({ path, force });
    process.stdout.write(
      `Wrote sample manifest to ${result.path}. ` +
        `Edit it, then run: ${CLI_NAME} validate -m ${result.path}\n`,
    );
  } catch (error: unknown) {
    reportCliError(error, `writing sample manifest to ${path}`);
    throw error;
  }
}

/**
 * Run the build pipeline (Phase 5: no dependency installation yet). On
 * success, print a short confirmation to stdout. On failure, print an
 * actionable error to stderr, set a non-zero exit code, and rethrow.
 */
export async function runBuild(
  manifestPath: string,
  outDir: string,
  options: { skipInstall?: boolean; skipSmokeTests?: boolean } = {},
): Promise<void> {
  try {
    const result = await buildBundle({
      manifestPath,
      outDir,
      skipInstall: options.skipInstall,
      skipSmokeTests: options.skipSmokeTests,
    });
    const installNote =
      result.install === null
        ? 'dependencies not installed (skipped)'
        : `dependencies installed via npm ${result.install.command}`;
    const smokeNote =
      result.smokeTests === null
        ? 'smoke tests skipped'
        : `${result.smokeTests.length} smoke test(s) passed`;
    const archiveNote =
      result.archive === null || result.checksums === null
        ? 'archive skipped'
        : `archive ${result.archive.archivePath} (sha256 ${result.checksums.sha256})`;
    process.stdout.write(
      `Built bundle workdir at ${result.paths.bundleDir}: ` +
        `${result.wrappers.length} wrapper(s), ${result.configs.length} config(s); ` +
        `${installNote}; ${smokeNote}; ${archiveNote}.\n`,
    );
  } catch (error: unknown) {
    reportCliError(error, `building bundle from ${manifestPath}`);
    throw error;
  }
}

/**
 * Pack an existing bundle workdir into a tar.gz archive plus checksums.txt
 * (PRD section 10.4). On success print a short confirmation to stdout; on
 * failure print an actionable error to stderr, set a non-zero exit code and
 * rethrow.
 */
export async function runPack(workdir: string, outDir: string): Promise<void> {
  try {
    const result = await packBundle({ workdir, outDir });
    process.stdout.write(
      `Packed ${workdir} into ${result.archive.archivePath} ` +
        `(sha256 ${result.checksums.sha256}); wrote ${result.checksums.checksumsPath}.\n`,
    );
  } catch (error: unknown) {
    reportCliError(error, `packing bundle workdir ${workdir}`);
    throw error;
  }
}

/**
 * Render the requested client config from the manifest and print it to stdout
 * (PRD section 10.5). On failure, print an actionable error to stderr.
 */
export async function runPrintConfig(manifestPath: string, client: string): Promise<void> {
  const render = PRINT_CONFIG_RENDERERS[client];
  if (render === undefined) {
    process.stderr.write(
      `Unknown client "${client}". Supported clients: ${PRINT_CONFIG_CLIENTS.join(', ')}.\n`,
    );
    process.exitCode = 1;
    throw new Error(`unknown client: ${client}`);
  }
  try {
    const manifest = await loadManifest(manifestPath);
    // Config text already ends with a trailing newline.
    process.stdout.write(render(manifest));
  } catch (error: unknown) {
    reportCliError(error, `printing ${client} config from ${manifestPath}`);
    throw error;
  }
}

/**
 * Report a CLI error to stderr only and set a non-zero exit code. Manifest
 * errors are already actionable, so they are printed verbatim; other errors
 * get a context prefix.
 */
function reportCliError(error: unknown, context: string): void {
  process.exitCode = 1;
  if (
    error instanceof ManifestValidationError ||
    error instanceof ManifestLoadError ||
    error instanceof PackBundleError ||
    error instanceof ManifestExistsError
  ) {
    process.stderr.write(`${error.message}\n`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error ${context}: ${message}\n`);
}

/**
 * Load and validate a manifest. On success, print a short confirmation to
 * stdout. On failure, print an actionable error to stderr and set a non-zero
 * exit code. Throws so the CLI runner can also flag the failure.
 */
export async function runValidate(manifestPath: string): Promise<void> {
  try {
    const manifest = await loadManifest(manifestPath);
    process.stdout.write(
      `Manifest ${manifestPath} is valid: ${manifest.servers.length} server(s), target ${manifest.bundle.target}.\n`,
    );
  } catch (error: unknown) {
    if (error instanceof ManifestValidationError || error instanceof ManifestLoadError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected error validating ${manifestPath}: ${message}\n`);
    process.exitCode = 1;
    throw error;
  }
}
