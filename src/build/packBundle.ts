import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest } from '../manifest/loadManifest.js';
import {
  createArchive,
  DEFAULT_ARCHIVE_NAME,
  type CreateArchiveResult,
} from './createArchive.js';
import { generateChecksums, type GenerateChecksumsResult } from './generateChecksums.js';

/**
 * Error thrown when a bundle workdir cannot be packed (e.g. missing manifest).
 */
export class PackBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackBundleError';
  }
}

/**
 * Options for {@link packBundle}.
 */
export interface PackBundleOptions {
  /** Path to a prepared bundle workdir (e.g. `dist/work/bundle`). */
  workdir: string;
  /** Output directory for the archive and checksums (defaults to `dist`). */
  outDir?: string;
}

/**
 * Result of packing a bundle workdir.
 */
export interface PackBundleResult {
  /** Archive details. */
  archive: CreateArchiveResult;
  /** Checksum details. */
  checksums: GenerateChecksumsResult;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pack an already-prepared bundle workdir into a tar.gz archive plus a
 * `checksums.txt`. The archive name is read from the bundle's `manifest.yaml`
 * (`bundle.archiveName`) when present.
 *
 * @throws PackBundleError when the workdir does not contain a manifest.yaml.
 */
export async function packBundle(options: PackBundleOptions): Promise<PackBundleResult> {
  const outDir = options.outDir ?? 'dist';
  const manifestPath = join(options.workdir, 'manifest.yaml');

  if (!(await pathExists(manifestPath))) {
    throw new PackBundleError(
      `Cannot pack "${options.workdir}": no manifest.yaml found. ` +
        'Pass a bundle workdir produced by `build` (e.g. dist/work/bundle).',
    );
  }

  const manifest = await loadManifest(manifestPath);
  const archiveName = manifest.bundle.archiveName ?? DEFAULT_ARCHIVE_NAME;

  const archive = await createArchive({
    bundleDir: options.workdir,
    outDir,
    archiveName,
  });
  const checksums = await generateChecksums({
    archivePath: archive.archivePath,
    outDir,
    bundleDir: options.workdir,
  });

  return { archive, checksums };
}
