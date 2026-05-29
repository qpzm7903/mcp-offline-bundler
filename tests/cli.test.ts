import { describe, expect, it } from 'vitest';
import { CLI_NAME, VERSION, createProgram } from '../src/index.js';

describe('cli scaffold', () => {
  it('exports a name and version', () => {
    expect(CLI_NAME).toBe('mcp-offline-bundler');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('builds a commander program with the expected commands', () => {
    const program = createProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toEqual(['build', 'init', 'pack', 'print-config', 'validate']);
  });

  it('imports the cli entrypoint module without throwing', async () => {
    await expect(import('../src/cli.js')).resolves.toBeDefined();
  });
});
