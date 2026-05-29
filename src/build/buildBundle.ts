import { copyFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Manifest } from '../manifest/schema.js';
import { loadManifest } from '../manifest/loadManifest.js';
import { writePackageJson } from './generatePackageJson.js';
import { generateWrappers, type WrittenWrapper } from './generateWrappers.js';
import { generateClientConfigs, type WrittenClientConfig } from './generateClientConfigs.js';
import { writeReadme } from './generateReadme.js';
import {
  installDependencies,
  type ExecaLike,
  type InstallDependenciesResult,
} from './installDependencies.js';
import {
  runSmokeTests,
  type SmokeExecaLike,
  type SmokeTestResult,
} from './runSmokeTests.js';
import {
  createArchive,
  DEFAULT_ARCHIVE_NAME,
  type CreateArchiveResult,
} from './createArchive.js';
import { generateChecksums, type GenerateChecksumsResult } from './generateChecksums.js';

/**
 * Layout of the build output directories, relative to the build `outDir`.
 *
 * - `<outDir>/work/bundle` is the prepared bundle workdir.
 */
export const WORK_SUBDIR = 'work';
export const BUNDLE_SUBDIR = 'bundle';

/**
 * Resolved paths for a build run.
 */
export interface BuildPaths {
  /** The build output directory (e.g. `dist`). */
  outDir: string;
  /** The work directory under `outDir` (e.g. `dist/work`). */
  workDir: string;
  /** The bundle root under the work dir (e.g. `dist/work/bundle`). */
  bundleDir: string;
}

/**
 * Compute the build output paths for a given output directory.
 */
export function resolveBuildPaths(outDir: string): BuildPaths {
  const workDir = join(outDir, WORK_SUBDIR);
  const bundleDir = join(workDir, BUNDLE_SUBDIR);
  return { outDir, workDir, bundleDir };
}

/**
 * Options for {@link buildBundle}.
 */
export interface BuildBundleOptions {
  /** Path to the manifest YAML file. */
  manifestPath: string;
  /** Build output directory (defaults to `dist`). */
  outDir?: string;
  /**
   * Skip `npm install` and smoke tests. Useful for offline/test runs that only
   * need the generated bundle layout. Defaults to `false`.
   */
  skipInstall?: boolean;
  /** Skip smoke tests only (install still runs). Defaults to `false`. */
  skipSmokeTests?: boolean;
  /**
   * Skip the final tar.gz + checksums step (produces only the bundle workdir).
   * Useful for offline/test runs. Defaults to `false`.
   */
  skipArchive?: boolean;
  /** Process spawner for dependency install; overridable for tests. */
  installExec?: ExecaLike;
  /** Process spawner for smoke tests; overridable for tests. */
  smokeExec?: SmokeExecaLike;
}

/**
 * Result of a successful build (excluding install/smoke/archive, which are
 * later phases).
 */
export interface BuildBundleResult {
  /** The validated manifest used for the build. */
  manifest: Manifest;
  /** Resolved build paths. */
  paths: BuildPaths;
  /** Path to the copied manifest.yaml inside the bundle. */
  manifestCopyPath: string;
  /** Path to the generated runtime package.json. */
  packageJsonPath: string;
  /** Generated wrappers. */
  wrappers: WrittenWrapper[];
  /** Generated client configs. */
  configs: WrittenClientConfig[];
  /** Path to the generated README.md. */
  readmePath: string;
  /** Install result, or null when install was skipped. */
  install: InstallDependenciesResult | null;
  /** Smoke test results, or null when smoke tests were skipped. */
  smokeTests: SmokeTestResult[] | null;
  /** Archive result, or null when archiving was skipped. */
  archive: CreateArchiveResult | null;
  /** Checksum result, or null when archiving was skipped. */
  checksums: GenerateChecksumsResult | null;
}

/**
 * Run the build pipeline up to (but not including) dependency installation.
 *
 * Steps, per PRD section 10.3 / plan Phase 5:
 * 1. Clear the work directory.
 * 2. Load the manifest.
 * 3. Validate the manifest (performed inside loadManifest).
 * 4. Copy the manifest into the bundle as `manifest.yaml`.
 * 5. Generate the runtime `package.json`.
 * 6. Generate wrappers.
 * 7. Generate client configs.
 * 8. Generate the README.
 *
 * Dependency installation, smoke tests and archiving are handled by later
 * phases and are intentionally not run here.
 *
 * @param options Build options (manifest path and output directory).
 * @returns Details of the generated bundle contents.
 */
export async function buildBundle(options: BuildBundleOptions): Promise<BuildBundleResult> {
  const outDir = options.outDir ?? 'dist';
  const paths = resolveBuildPaths(outDir);

  const skipInstall = options.skipInstall ?? false;
  const skipSmokeTests = options.skipSmokeTests ?? skipInstall;
  const skipArchive = options.skipArchive ?? false;

  // 1. Clear the work directory so the bundle is built from a clean slate.
  await rm(paths.workDir, { recursive: true, force: true });

  // When we run a real `npm install`, do it in an isolated staging directory
  // under the OS temp dir rather than inside `<outDir>/work/bundle`. npm's
  // dependency resolution dedupes against any ancestor `node_modules`, so
  // installing inside this tool's own repo (or any project) would leave the
  // bundle missing transitive deps — broken once extracted standalone. The
  // finished bundle is relocated to its final path afterwards.
  let stagingRoot: string | null = null;
  let buildDir: string;
  if (skipInstall) {
    buildDir = paths.bundleDir;
    await mkdir(buildDir, { recursive: true });
  } else {
    stagingRoot = await mkdtemp(join(tmpdir(), 'mcp-offline-bundle-'));
    buildDir = join(stagingRoot, BUNDLE_SUBDIR);
    await mkdir(buildDir, { recursive: true });
  }

  try {
    // 2 + 3. Load and validate the manifest.
    const manifest = await loadManifest(options.manifestPath);

    // 4. Copy the manifest verbatim into the bundle as manifest.yaml.
    await copyFile(options.manifestPath, join(buildDir, 'manifest.yaml'));

    // 5. Generate the runtime package.json.
    await writePackageJson(buildDir, manifest);

    // 6. Install dependencies (unless skipped for offline/test runs).
    let install: InstallDependenciesResult | null = null;
    if (!skipInstall) {
      install = await installDependencies({
        bundleDir: buildDir,
        manifest,
        exec: options.installExec,
      });
    }

    // 7. Generate wrappers.
    let wrappers = await generateWrappers(buildDir, manifest);

    // 8. Generate client configs.
    let configs = await generateClientConfigs(buildDir, manifest);

    // 9. Generate the README.
    await writeReadme(buildDir, manifest);

    // 10. Run smoke tests against the generated wrappers (needs deps installed).
    let smokeTests: SmokeTestResult[] | null = null;
    if (!skipSmokeTests) {
      smokeTests = await runSmokeTests({
        bundleDir: buildDir,
        manifest,
        exec: options.smokeExec,
      });
    }

    // Relocate the staged bundle to its final `<outDir>/work/bundle` location.
    // Use copy + remove (rather than rename) so it works across filesystems
    // (the temp dir is commonly on a different device than the repo), then
    // re-run the path-dependent generators so the returned wrappers/configs
    // reference the final bundle directory (cheap, deterministic).
    if (stagingRoot !== null) {
      await mkdir(dirname(paths.bundleDir), { recursive: true });
      await cp(buildDir, paths.bundleDir, { recursive: true, verbatimSymlinks: true });
      wrappers = await generateWrappers(paths.bundleDir, manifest);
      configs = await generateClientConfigs(paths.bundleDir, manifest);
    }

    const manifestCopyPath = join(paths.bundleDir, 'manifest.yaml');
    const packageJsonPath = join(paths.bundleDir, 'package.json');
    const readmePath = join(paths.bundleDir, 'README.md');

    // 11 + 12. Create the tar.gz archive and its checksums (unless skipped).
    let archive: CreateArchiveResult | null = null;
    let checksums: GenerateChecksumsResult | null = null;
    if (!skipArchive) {
      const archiveName = manifest.bundle.archiveName ?? DEFAULT_ARCHIVE_NAME;
      archive = await createArchive({
        bundleDir: paths.bundleDir,
        outDir: paths.outDir,
        archiveName,
      });
      checksums = await generateChecksums({
        archivePath: archive.archivePath,
        outDir: paths.outDir,
        bundleDir: paths.bundleDir,
      });
    }

    return {
      manifest,
      paths,
      manifestCopyPath,
      packageJsonPath,
      wrappers,
      configs,
      readmePath,
      install,
      smokeTests,
      archive,
      checksums,
    };
  } finally {
    if (stagingRoot !== null) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}
