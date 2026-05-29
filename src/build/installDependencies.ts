import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { execa, type ResultPromise } from 'execa';
import type { Manifest } from '../manifest/schema.js';

/**
 * Default Playwright env var that disables browser downloads during install.
 * Always defaulted on so installs never attempt to fetch Chromium/Firefox.
 */
export const PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD';

/** Lockfile name that, when present, makes us prefer `npm ci`. */
export const LOCKFILE_NAME = 'package-lock.json';

/**
 * Function used to spawn the install process. Matches the subset of execa's
 * signature we rely on, so tests can inject a mock.
 */
export type ExecaLike = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string | undefined>; reject?: boolean },
) => ResultPromise;

/**
 * Options for {@link installDependencies}.
 */
export interface InstallDependenciesOptions {
  /** Bundle directory containing the generated runtime package.json. */
  bundleDir: string;
  /** Validated manifest (its `install.env` is merged into the environment). */
  manifest: Manifest;
  /** Process spawner; defaults to execa. Overridable for tests. */
  exec?: ExecaLike;
  /** Override for testing whether a lockfile exists. */
  lockfileExists?: (lockfilePath: string) => Promise<boolean>;
}

/**
 * Result of a successful dependency install.
 */
export interface InstallDependenciesResult {
  /** The npm subcommand chosen (`ci` or `install`). */
  command: 'ci' | 'install';
  /** The full argument vector passed to npm. */
  args: string[];
  /** Whether a lockfile was detected. */
  usedLockfile: boolean;
  /** Captured stdout from the install command. */
  stdout: string;
  /** Captured stderr from the install command. */
  stderr: string;
}

/**
 * Error thrown when dependency installation fails. The message surfaces the
 * exact command, exit code and key log output so it is actionable.
 */
export class InstallDependenciesError extends Error {
  readonly command: string;
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;

  constructor(args: {
    command: string;
    exitCode: number | undefined;
    stdout: string;
    stderr: string;
  }) {
    super(buildInstallErrorMessage(args));
    this.name = 'InstallDependenciesError';
    this.command = args.command;
    this.exitCode = args.exitCode;
    this.stdout = args.stdout;
    this.stderr = args.stderr;
  }
}

/** Keep only the last `maxLines` lines of a log blob. */
function tailLines(text: string, maxLines = 40): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return text.trim();
  }
  return lines.slice(-maxLines).join('\n').trim();
}

function buildInstallErrorMessage(args: {
  command: string;
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}): string {
  const parts = [
    `Dependency install failed: \`${args.command}\` exited with code ${args.exitCode ?? 'unknown'}.`,
  ];
  const err = tailLines(args.stderr);
  const out = tailLines(args.stdout);
  if (err.length > 0) {
    parts.push(`stderr (tail):\n${err}`);
  }
  if (out.length > 0) {
    parts.push(`stdout (tail):\n${out}`);
  }
  parts.push('Check network access, the manifest versions, and the npm logs above.');
  return parts.join('\n\n');
}

async function defaultLockfileExists(lockfilePath: string): Promise<boolean> {
  try {
    await access(lockfilePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the environment for the install process: inherit the current
 * environment, then layer the manifest `install.env`, and default
 * `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` only when not already set by the
 * manifest or the surrounding environment.
 */
export function buildInstallEnv(manifest: Manifest): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...manifest.install.env,
  };
  if (env[PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD] === undefined) {
    env[PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD] = '1';
  }
  return env;
}

/**
 * Install runtime dependencies into the bundle directory.
 *
 * Uses `npm ci --omit=dev` when a `package-lock.json` is present, otherwise
 * `npm install --omit=dev` (which also generates a lockfile). The manifest's
 * `install.env` is merged into the environment and browser downloads are
 * disabled by default.
 *
 * @throws InstallDependenciesError when npm exits with a non-zero code.
 */
export async function installDependencies(
  options: InstallDependenciesOptions,
): Promise<InstallDependenciesResult> {
  const { bundleDir, manifest } = options;
  const exec = options.exec ?? (execa as unknown as ExecaLike);
  const lockfileExists = options.lockfileExists ?? defaultLockfileExists;

  const usedLockfile = await lockfileExists(join(bundleDir, LOCKFILE_NAME));
  const subcommand: 'ci' | 'install' = usedLockfile ? 'ci' : 'install';
  const args = [subcommand, '--omit=dev'];
  const env = buildInstallEnv(manifest);
  const commandStr = `npm ${args.join(' ')}`;

  try {
    const result = await exec('npm', args, { cwd: bundleDir, env, reject: true });
    return {
      command: subcommand,
      args,
      usedLockfile,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch (error: unknown) {
    const e = error as { exitCode?: number; stdout?: unknown; stderr?: unknown };
    throw new InstallDependenciesError({
      command: commandStr,
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : '',
    });
  }
}
