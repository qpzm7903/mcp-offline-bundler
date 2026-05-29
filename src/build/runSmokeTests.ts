import { join } from 'node:path';
import { execa, type ResultPromise } from 'execa';
import type { Manifest, ServerConfig } from '../manifest/schema.js';

/**
 * Default smoke test timeout in milliseconds (PRD 9.7: 20 seconds).
 */
export const SMOKE_TEST_TIMEOUT_MS = 20_000;

/**
 * Function used to spawn a smoke test process. Matches the subset of execa's
 * signature we rely on, so tests can inject a mock.
 */
export type SmokeExecaLike = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; reject?: boolean },
) => ResultPromise;

/**
 * Captured outcome of a single server's smoke test.
 */
export interface SmokeTestResult {
  /** Server name. */
  server: string;
  /** Wrapper path that was executed. */
  wrapperPath: string;
  /** Arguments passed to the wrapper. */
  args: string[];
  /** Exit code (0 on success). */
  exitCode: number | undefined;
  /** Captured stdout from the smoke test. */
  stdout: string;
  /** Captured stderr from the smoke test. */
  stderr: string;
  /** Whether the smoke test timed out. */
  timedOut: boolean;
}

/**
 * Error thrown when one or more smoke tests fail (non-zero exit or timeout).
 * The message lists the failing servers with exit codes and log tails.
 */
export class SmokeTestError extends Error {
  readonly results: SmokeTestResult[];

  constructor(failures: SmokeTestResult[]) {
    super(buildSmokeErrorMessage(failures));
    this.name = 'SmokeTestError';
    this.results = failures;
  }
}

function tailLines(text: string, maxLines = 30): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return text.trim();
  }
  return lines.slice(-maxLines).join('\n').trim();
}

function buildSmokeErrorMessage(failures: SmokeTestResult[]): string {
  const blocks = failures.map((f) => {
    const reason = f.timedOut
      ? `timed out after ${SMOKE_TEST_TIMEOUT_MS / 1000}s`
      : `exited with code ${f.exitCode ?? 'unknown'}`;
    const header = `- ${f.server} (bin/${f.server} ${f.args.join(' ')}): ${reason}`;
    const err = tailLines(f.stderr);
    return err.length > 0 ? `${header}\n  stderr (tail):\n  ${err.replace(/\n/g, '\n  ')}` : header;
  });
  return [
    `Smoke test failed for ${failures.length} server(s):`,
    ...blocks,
    'Fix the failing server(s) or their smokeTestArgs, then rebuild.',
  ].join('\n');
}

/**
 * Options for {@link runSmokeTests}.
 */
export interface RunSmokeTestsOptions {
  /** Bundle directory containing the generated `bin/` wrappers. */
  bundleDir: string;
  /** Validated manifest driving which servers and args to test. */
  manifest: Manifest;
  /** Process spawner; defaults to execa. Overridable for tests. */
  exec?: SmokeExecaLike;
  /** Timeout override in milliseconds (defaults to 20s). */
  timeoutMs?: number;
}

function smokeArgsFor(server: ServerConfig): string[] {
  // The schema already defaults smokeTestArgs to ["--help"], but guard anyway.
  return server.smokeTestArgs.length > 0 ? server.smokeTestArgs : ['--help'];
}

/**
 * Execute each generated wrapper with its `smokeTestArgs` (default `--help`)
 * to verify the server is launchable. Each run is bounded by a 20s timeout.
 *
 * @throws SmokeTestError when any server exits non-zero or times out.
 */
export async function runSmokeTests(
  options: RunSmokeTestsOptions,
): Promise<SmokeTestResult[]> {
  const { bundleDir, manifest } = options;
  const exec = options.exec ?? (execa as unknown as SmokeExecaLike);
  const timeout = options.timeoutMs ?? SMOKE_TEST_TIMEOUT_MS;

  const results: SmokeTestResult[] = [];
  const failures: SmokeTestResult[] = [];

  for (const server of manifest.servers) {
    const wrapperPath = join(bundleDir, 'bin', server.name);
    const args = smokeArgsFor(server);
    let result: SmokeTestResult;
    try {
      const r = await exec(wrapperPath, args, { cwd: bundleDir, timeout, reject: true });
      result = {
        server: server.name,
        wrapperPath,
        args,
        exitCode: typeof r.exitCode === 'number' ? r.exitCode : 0,
        stdout: typeof r.stdout === 'string' ? r.stdout : '',
        stderr: typeof r.stderr === 'string' ? r.stderr : '',
        timedOut: false,
      };
    } catch (error: unknown) {
      const e = error as {
        exitCode?: number;
        stdout?: unknown;
        stderr?: unknown;
        timedOut?: boolean;
      };
      result = {
        server: server.name,
        wrapperPath,
        args,
        exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
        stdout: typeof e.stdout === 'string' ? e.stdout : '',
        stderr: typeof e.stderr === 'string' ? e.stderr : '',
        timedOut: e.timedOut === true,
      };
      failures.push(result);
    }
    results.push(result);
  }

  if (failures.length > 0) {
    throw new SmokeTestError(failures);
  }
  return results;
}
