import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * The fixed name of the generated checksum manifest.
 */
export const CHECKSUMS_FILE_NAME = 'checksums.txt';

/**
 * Options for {@link generateChecksums}.
 */
export interface GenerateChecksumsOptions {
  /** Path to the archive file whose checksum is computed. */
  archivePath: string;
  /** Output directory where `checksums.txt` is written (e.g. `dist`). */
  outDir: string;
  /**
   * Optional bundle directory. When provided, a copy of `checksums.txt` is
   * also written inside the bundle root so it travels with the extracted
   * bundle. Note: this copy is made after archiving, so it is NOT inside the
   * archive itself.
   */
  bundleDir?: string;
}

/**
 * Result of a successful checksum generation.
 */
export interface GenerateChecksumsResult {
  /** Lowercase hex SHA-256 digest of the archive. */
  sha256: string;
  /** A single `checksums.txt` line: `<sha256>  <archiveFileName>`. */
  line: string;
  /** Path to the `checksums.txt` written in `outDir`. */
  checksumsPath: string;
  /** Path to the `checksums.txt` copied into the bundle, if any. */
  bundleChecksumsPath: string | null;
}

/**
 * Compute the lowercase hex SHA-256 digest of a file by streaming it.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

/**
 * Format a single `checksums.txt` line. The format matches `sha256sum` output
 * (two spaces between digest and file name) so `sha256sum -c checksums.txt`
 * verifies it directly.
 */
export function formatChecksumLine(sha256: string, fileName: string): string {
  return `${sha256}  ${fileName}`;
}

/**
 * Generate a `checksums.txt` file containing the SHA-256 of the archive.
 *
 * The file is written to `outDir/checksums.txt` and, when `bundleDir` is given,
 * a copy is also placed at `bundleDir/checksums.txt`. The line format is
 * `<sha256>  <archiveFileName>` so it is verifiable with `sha256sum -c`.
 *
 * @param options Archive path, output directory and optional bundle directory.
 * @returns Details of the produced checksum file.
 */
export async function generateChecksums(
  options: GenerateChecksumsOptions,
): Promise<GenerateChecksumsResult> {
  const fileName = basename(options.archivePath);
  const sha256 = await sha256File(options.archivePath);
  const line = formatChecksumLine(sha256, fileName);
  const content = `${line}\n`;

  await mkdir(options.outDir, { recursive: true });
  const checksumsPath = join(options.outDir, CHECKSUMS_FILE_NAME);
  await writeFile(checksumsPath, content, 'utf8');

  let bundleChecksumsPath: string | null = null;
  if (options.bundleDir !== undefined) {
    await mkdir(options.bundleDir, { recursive: true });
    bundleChecksumsPath = join(options.bundleDir, CHECKSUMS_FILE_NAME);
    await copyFile(checksumsPath, bundleChecksumsPath);
  }

  return { sha256, line, checksumsPath, bundleChecksumsPath };
}
