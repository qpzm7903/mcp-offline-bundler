import { z } from 'zod';

/**
 * The only bundle target supported by the MVP.
 */
export const SUPPORTED_TARGET = 'linux-x64' as const;

/**
 * The only transport supported by the MVP.
 */
export const SUPPORTED_TRANSPORT = 'stdio' as const;

/**
 * Server name pattern: lowercase letters, digits and hyphens only.
 */
export const SERVER_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Return true when the given string is an exact, deterministic version.
 *
 * Rejects: empty, `latest`, `*`, ranges/prefixes such as `^1.2.3`, `~1.2.3`,
 * `>=1.2.3`, `<=1.2.3`, `>1.2.3`, `<1.2.3`, `1.x`, comparator/whitespace lists.
 * Accepts exact semver including pre-release and build metadata, e.g.
 * `1.2.3`, `1.2.3-beta.1`, `1.2.3+build.5`.
 */
export function isExactVersion(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed !== value) {
    // Surrounding whitespace is not an exact version.
    return false;
  }
  if (trimmed === 'latest' || trimmed === '*') {
    return false;
  }
  // Reject any range operator / prefix / wildcard / list separators.
  if (/[\^~><=*|\s]/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('x') || trimmed.includes('X')) {
    // 1.x / 1.X style partial versions are not exact.
    return false;
  }
  // Strict exact semver: MAJOR.MINOR.PATCH with optional -prerelease and +build.
  const exactSemver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
  return exactSemver.test(trimmed);
}

const exactVersionSchema = z
  .string({ required_error: 'version is required', invalid_type_error: 'version must be a string' })
  .refine(isExactVersion, (value) => ({
    message: `must be an exact version, but got ${JSON.stringify(value)}`,
  }));

const serverNameSchema = z
  .string({ required_error: 'name is required', invalid_type_error: 'name must be a string' })
  .min(1, 'name is required')
  .regex(SERVER_NAME_PATTERN, 'must match /^[a-z0-9-]+$/');

const stringRecordSchema = z.record(
  z.string(),
  z.string({ invalid_type_error: 'env values must be strings' }),
);

/**
 * Zod schema for a single MCP server entry.
 */
export const serverSchema = z
  .object({
    name: serverNameSchema,
    package: z
      .string({
        required_error: 'package is required',
        invalid_type_error: 'package must be a string',
      })
      .min(1, 'package is required'),
    version: exactVersionSchema,
    bin: z
      .string({ required_error: 'bin is required', invalid_type_error: 'bin must be a string' })
      .min(1, 'bin is required'),
    transport: z
      .literal(SUPPORTED_TRANSPORT, {
        errorMap: () => ({ message: `transport must be "${SUPPORTED_TRANSPORT}"` }),
      })
      .default(SUPPORTED_TRANSPORT),
    args: z.array(z.string({ invalid_type_error: 'args entries must be strings' })).default([]),
    env: stringRecordSchema.default({}),
    smokeTestArgs: z
      .array(z.string({ invalid_type_error: 'smokeTestArgs entries must be strings' }))
      .default(['--help']),
  })
  .strict();

/**
 * Zod schema for the bundle metadata block.
 */
export const bundleSchema = z
  .object({
    name: z
      .string({ required_error: 'name is required', invalid_type_error: 'name must be a string' })
      .min(1, 'name is required'),
    target: z.literal(SUPPORTED_TARGET, {
      errorMap: () => ({ message: `target must be "${SUPPORTED_TARGET}"` }),
    }),
    node: z
      .string({ required_error: 'node is required', invalid_type_error: 'node must be a string' })
      .min(1, 'node is required'),
    archiveName: z.string().min(1).optional(),
  })
  .strict();

/**
 * Zod schema for the install configuration block.
 */
export const installSchema = z
  .object({
    packageManager: z.literal('npm').default('npm'),
    omitDev: z.boolean().default(true),
    env: stringRecordSchema.default({}),
  })
  .strict()
  .default({ packageManager: 'npm', omitDev: true, env: {} });

/**
 * Zod schema for the clients configuration block.
 */
export const clientsSchema = z
  .object({
    claudeDesktop: z.boolean().default(true),
    codex: z.boolean().default(true),
    cursor: z.boolean().default(true),
    genericJson: z.boolean().default(true),
  })
  .strict()
  .default({ claudeDesktop: true, codex: true, cursor: true, genericJson: true });

/**
 * Zod schema for the whole manifest.
 */
export const manifestSchema = z
  .object({
    bundle: bundleSchema,
    install: installSchema,
    servers: z.array(serverSchema).min(1, 'at least one server is required'),
    clients: clientsSchema,
  })
  .strict();

/**
 * A single validated MCP server entry (after defaults are applied).
 */
export type ServerConfig = z.infer<typeof serverSchema>;

/**
 * The validated bundle metadata block.
 */
export type BundleConfig = z.infer<typeof bundleSchema>;

/**
 * The validated install configuration block.
 */
export type InstallConfig = z.infer<typeof installSchema>;

/**
 * The validated clients configuration block.
 */
export type ClientsConfig = z.infer<typeof clientsSchema>;

/**
 * The fully validated manifest with defaults applied.
 */
export type Manifest = z.infer<typeof manifestSchema>;
