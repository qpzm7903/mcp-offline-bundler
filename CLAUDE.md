# AGENTS.md / CLAUDE.md

## Project

This repository implements `mcp-offline-bundler`, a CLI tool that builds offline runtime bundles for npm-based MCP servers.

The main use case is:

* Build on an online Linux / WSL-compatible environment.
* Package selected MCP servers from a manifest.
* Produce a linux-x64 tar.gz bundle.
* Use the bundle later in an offline or restricted network environment.
* Run MCP servers locally through stdio commands.

## Product boundary

Do not turn this project into a general npm registry, package mirror, GUI app, or cross-platform bundle system.

MVP only supports:

* linux-x64
* Node.js >= 20
* npm
* npm package based MCP servers
* stdio transport
* tar.gz output

MVP does not support:

* Windows bundle output
* macOS bundle output
* embedding Chrome or Chromium
* downloading Playwright browsers
* editing user MCP client config files in place
* private npm authentication
* GUI
* running real browser tests during CI

## Core commands

The final CLI should expose:

```bash
mcp-offline-bundler init
mcp-offline-bundler validate -m mcp.manifest.yaml
mcp-offline-bundler build -m mcp.manifest.yaml --out dist
mcp-offline-bundler pack --workdir dist/work/bundle --out dist
mcp-offline-bundler print-config -m mcp.manifest.yaml --client generic
```

## Development commands

Use these commands while developing:

```bash
npm install
npm run lint
npm test
npm run build
npm run bundle
```

If a command does not exist yet, add it to `package.json`.

## Code style

* Use TypeScript.
* Use ESM.
* Prefer small modules.
* Keep public functions explicit and typed.
* Avoid hidden global state.
* Avoid shell-specific logic except in generated wrapper scripts.
* Do not write logs to stdout inside generated MCP wrappers.
* Error messages must be actionable.
* Prefer clear code over clever code.

## Architecture

Recommended source layout:

```text
src/
  cli.ts
  index.ts

  manifest/
    schema.ts
    loadManifest.ts
    validateManifest.ts

  build/
    buildBundle.ts
    generatePackageJson.ts
    installDependencies.ts
    generateWrappers.ts
    generateClientConfigs.ts
    generateReadme.ts
    runSmokeTests.ts
    createArchive.ts
    generateChecksums.ts

  clients/
    genericJson.ts
    claudeDesktop.ts
    codexToml.ts
    cursorJson.ts

  utils/
    fs.ts
    shell.ts
    logger.ts
    paths.ts
    semver.ts
```

## Manifest rules

The manifest is the source of truth.

Reject any server version that is not exact.

Invalid examples:

```text
latest
*
^1.2.3
~1.2.3
>=1.2.3
```

Valid examples:

```text
1.2.3
1.2.3-beta.1
```

Every server must have:

```yaml
name: string
package: string
version: exact version
bin: string
transport: stdio
```

## Generated wrapper rules

Generated wrapper scripts must:

* Be executable.
* Use bash.
* Locate bundle directory relative to wrapper location.
* Execute `node_modules/.bin/{server.bin}`.
* Forward all user args.
* Inject default env values using `${VAR:-default}`.
* Never print informational logs to stdout.
* Only write errors to stderr.

## Testing requirements

For every new feature, add tests.

Minimum tests:

* Manifest loads from YAML.
* Manifest rejects `latest`.
* Manifest rejects duplicate server names.
* Package JSON generation maps package names to exact versions.
* Wrapper generation creates executable wrapper content.
* Generic JSON config generation works.
* Codex TOML config generation works.
* Archive creation includes expected files.
* Checksum generation works.

## Build behavior

`build` should:

1. Clear workdir.
2. Load manifest.
3. Validate manifest.
4. Generate runtime package.json.
5. Install npm dependencies.
6. Generate wrappers.
7. Generate configs.
8. Generate README.
9. Run smoke tests.
10. Create tar.gz archive.
11. Generate checksums.

## Safety requirements

Do not add code that:

* Uploads secrets.
* Reads user browser profiles.
* Writes user MCP config files without explicit command.
* Downloads browsers by default.
* Uses latest package versions.
* Silently ignores validation errors.
* Writes non-MCP text to wrapper stdout.

## Implementation discipline

Work in small commits or small patches.

After each phase, run:

```bash
npm run lint
npm test
npm run build
```

If tests fail, fix them before adding more functionality.

Do not rewrite the entire repository when a targeted change is enough.

## Initial MVP example

The default example manifest should include:

* chrome-devtools-mcp
* @playwright/mcp

But do not hardcode those packages into the core implementation. They must come from the manifest.
