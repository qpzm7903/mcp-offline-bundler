import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, PatchConfig } from '../manifest/schema.js';

/**
 * Result of applying a single patch.
 */
export interface AppliedPatch {
  /** Package the patch targeted. */
  package: string;
  /** File (relative to the package) the patch targeted. */
  file: string;
  /** Number of occurrences replaced. */
  replacements: number;
}

/**
 * Error thrown when a patch cannot be applied. The message is actionable: it
 * names the package/file and whether the target text was missing or matched the
 * wrong number of times (which usually means the package version changed).
 */
export class ApplyPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyPatchError';
  }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Apply a single find/replace patch to a file inside the bundle's installed
 * packages.
 *
 * @throws ApplyPatchError when the target file/text is missing or the number of
 * occurrences does not match `patch.count` (when specified).
 */
export async function applyPatch(bundleDir: string, patch: PatchConfig): Promise<AppliedPatch> {
  const target = join(bundleDir, 'node_modules', patch.package, patch.file);

  let original: string;
  try {
    original = await readFile(target, 'utf8');
  } catch {
    throw new ApplyPatchError(
      `Patch target not found: ${patch.package}/${patch.file} ` +
        `(looked in node_modules). The package may not be installed or its ` +
        `layout changed for this version.`,
    );
  }

  const occurrences = countOccurrences(original, patch.find);
  if (occurrences === 0) {
    throw new ApplyPatchError(
      `Patch text not found in ${patch.package}/${patch.file}. ` +
        `The find string did not match — the package version likely changed. ` +
        `Update the patch in the manifest.`,
    );
  }
  if (patch.count !== undefined && occurrences !== patch.count) {
    throw new ApplyPatchError(
      `Patch for ${patch.package}/${patch.file} expected ${patch.count} ` +
        `occurrence(s) but found ${occurrences}. Update the manifest patch.`,
    );
  }

  const patched = original.split(patch.find).join(patch.replace);
  await writeFile(target, patched, 'utf8');

  return { package: patch.package, file: patch.file, replacements: occurrences };
}

/**
 * Apply all `install.patches` from the manifest to the bundle's `node_modules`.
 *
 * Runs after dependency installation. Patches are deterministic exact
 * find/replace edits; a missing target or mismatched occurrence count fails the
 * build rather than silently shipping an unpatched bundle.
 *
 * @returns The list of applied patches (empty when none are configured).
 */
export async function applyPatches(bundleDir: string, manifest: Manifest): Promise<AppliedPatch[]> {
  const applied: AppliedPatch[] = [];
  for (const patch of manifest.install.patches) {
    applied.push(await applyPatch(bundleDir, patch));
  }
  return applied;
}
