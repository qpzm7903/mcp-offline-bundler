import { z } from 'zod';
import { manifestSchema, type Manifest } from './schema.js';

/**
 * Error thrown when a manifest fails validation. The message lists every
 * problem found so the user can fix them in one pass.
 */
export class ManifestValidationError extends Error {
  /**
   * The individual, human-readable validation problems.
   */
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(formatIssues(issues));
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}

/**
 * Format a zod issue path like `servers[0].version` (array indices use
 * bracket notation, object keys use dot notation).
 */
function formatPath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (out.length === 0) {
      out += segment;
    } else {
      out += `.${segment}`;
    }
  }
  return out;
}

/**
 * Turn a list of issues into a single actionable error message.
 */
function formatIssues(issues: string[]): string {
  return ['Invalid manifest:', ...issues.map((issue) => `- ${issue}`)].join('\n');
}

/**
 * Collect duplicate server-name issues. Reported once per duplicated name.
 */
function findDuplicateServerNames(servers: ReadonlyArray<{ name?: unknown }>): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const issues: string[] = [];
  servers.forEach((server, index) => {
    const name = server?.name;
    if (typeof name !== 'string') {
      return;
    }
    if (seen.has(name) && !reported.has(name)) {
      issues.push(`servers[${index}].name "${name}" is duplicated; server names must be unique`);
      reported.add(name);
    }
    seen.add(name);
  });
  return issues;
}

/**
 * Validate a raw, parsed manifest object against the schema and the
 * additional cross-field rules (e.g. unique server names).
 *
 * @throws ManifestValidationError when the manifest is invalid.
 */
export function validateManifest(raw: unknown): Manifest {
  const result = manifestSchema.safeParse(raw);

  const schemaIssues =
    result.success === false
      ? result.error.issues.map((issue: z.ZodIssue) => {
          const path = formatPath(issue.path);
          return path.length > 0 ? `${path} ${issue.message}` : issue.message;
        })
      : [];

  // Duplicate-name detection works on the raw servers array so it still runs
  // even when other schema issues are present.
  const rawServers =
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { servers?: unknown }).servers)
      ? ((raw as { servers: Array<{ name?: unknown }> }).servers)
      : [];
  const duplicateIssues = findDuplicateServerNames(rawServers);

  const issues = [...schemaIssues, ...duplicateIssues];
  if (issues.length > 0) {
    throw new ManifestValidationError(issues);
  }

  // result.success must be true here because schemaIssues was empty.
  if (result.success === false) {
    throw new ManifestValidationError(['unexpected validation failure']);
  }
  return result.data;
}
