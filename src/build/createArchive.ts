import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { create as tarCreate } from 'tar';

/**
 * The fixed root directory name inside the produced tar.gz archive. Every
 * archive entry is prefixed with this so extraction yields a single
 * `mcp-offline-bundle/` directory (PRD section 9.8 / plan Phase 7).
 */
export const ARCHIVE_ROOT_DIR = 'mcp-offline-bundle';

/**
 * The default archive base name (without the `.tar.gz` extension), used when
 * the manifest does not specify `bundle.archiveName`.
 */
export const DEFAULT_ARCHIVE_NAME = 'mcp-offline-bundle-linux-x64';

/**
 * Options for {@link createArchive}.
 */
export interface CreateArchiveOptions {
  /** Bundle root directory whose contents are archived (e.g. `dist/work/bundle`). */
  bundleDir: string;
  /** Output directory for the archive (e.g. `dist`). */
  outDir: string;
  /**
   * Archive base name without extension. The produced file is
   * `<archiveName>.tar.gz`. Defaults to {@link DEFAULT_ARCHIVE_NAME}.
   */
  archiveName?: string;
}

/**
 * Result of a successful archive creation.
 */
export interface CreateArchiveResult {
  /** Archive base name without extension. */
  archiveName: string;
  /** File name of the archive (`<archiveName>.tar.gz`). */
  archiveFileName: string;
  /** Full path to the produced archive under `outDir`. */
  archivePath: string;
  /** Root directory name inside the archive. */
  rootDir: string;
}

/**
 * Create a gzip-compressed tar archive of the bundle directory.
 *
 * All entries are placed under a single `mcp-offline-bundle/` root directory so
 * that `tar -xzf <archive>.tar.gz` extracts into one predictable folder. The
 * archive is written to `<outDir>/<archiveName>.tar.gz`.
 *
 * @param options Bundle directory, output directory and archive name.
 * @returns Details of the produced archive.
 */
export async function createArchive(
  options: CreateArchiveOptions,
): Promise<CreateArchiveResult> {
  const archiveName = options.archiveName ?? DEFAULT_ARCHIVE_NAME;
  const archiveFileName = `${archiveName}.tar.gz`;
  const archivePath = join(options.outDir, archiveFileName);

  await mkdir(options.outDir, { recursive: true });

  // Top-level entries of the bundle directory, added relative to `cwd` so the
  // archive does not embed the host's absolute paths.
  const entries = await readdir(options.bundleDir);

  await tarCreate(
    {
      cwd: options.bundleDir,
      file: archivePath,
      gzip: true,
      // Deterministic ownership/permissions; avoids leaking host uid/gid.
      portable: true,
      // Place every entry under the fixed root directory.
      prefix: ARCHIVE_ROOT_DIR,
    },
    entries,
  );

  return {
    archiveName,
    archiveFileName,
    archivePath,
    rootDir: ARCHIVE_ROOT_DIR,
  };
}
