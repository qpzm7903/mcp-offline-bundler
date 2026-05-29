# Development Plan for Claude Code or Codex

## How to use this plan

Create these files first:

```text
docs/PRD.md
AGENTS.md
CLAUDE.md
mcp.manifest.yaml
```

Put the PRD into `docs/PRD.md`.

Put the project instructions into both `AGENTS.md` and `CLAUDE.md`.

Then ask Claude Code or Codex to implement one phase at a time.

Do not ask the agent to implement everything in one shot.

---

## Phase 0: Repository bootstrap

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 0 only.

Goal:
Create the initial TypeScript CLI project scaffold for mcp-offline-bundler.

Requirements:
1. Create package.json with scripts:
   - build
   - lint
   - test
   - bundle
   - cli
2. Add TypeScript config.
3. Add Vitest config.
4. Add ESLint and Prettier config if needed.
5. Create src/cli.ts and src/index.ts.
6. Implement a placeholder CLI with commander.
7. Add an initial test that verifies the CLI module can be imported.
8. Do not implement manifest parsing yet.
9. Run npm install if needed.
10. Run npm test and npm run build.

Acceptance:
- npm test passes.
- npm run build passes.
- src/cli.ts exists.
- package.json has all required scripts.
```

---

## Phase 1: Manifest schema and validation

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 1 only: manifest loading and validation.

Requirements:
1. Add src/manifest/schema.ts.
2. Add src/manifest/loadManifest.ts.
3. Add src/manifest/validateManifest.ts.
4. Use yaml to parse YAML.
5. Use zod or equivalent validation.
6. Implement exact version validation:
   - reject latest
   - reject *
   - reject versions starting with ^ or ~
   - reject range operators such as >=, <=, >, <
7. Require bundle.name, bundle.target, bundle.node.
8. Only allow bundle.target = linux-x64.
9. Require at least one server.
10. Require server.name, server.package, server.version, server.bin.
11. Default server.transport to stdio.
12. Only allow transport = stdio.
13. Reject duplicate server names.
14. Add tests for valid and invalid manifests.
15. Add CLI command:
    mcp-offline-bundler validate -m mcp.manifest.yaml

Acceptance:
- npm test passes.
- npm run build passes.
- validate command succeeds for valid manifest.
- validate command fails with clear errors for invalid manifest.
```

---

## Phase 2: Generate runtime package.json

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 2 only: runtime package.json generation.

Requirements:
1. Add src/build/generatePackageJson.ts.
2. Generate a package.json object from manifest.servers.
3. dependencies must map each server.package to server.version.
4. Output package must be:
   - private: true
   - type: module
   - name: mcp-offline-bundle-runtime
5. Write package.json to workdir.
6. Add unit tests.
7. Do not install npm dependencies yet.

Acceptance:
- npm test passes.
- npm run build passes.
- package JSON generation handles scoped packages.
```

---

## Phase 3: Generate wrappers

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 3 only: wrapper generation.

Requirements:
1. Add src/build/generateWrappers.ts.
2. For each server, generate bin/{server.name}.
3. The wrapper must:
   - use bash
   - use set -euo pipefail
   - compute DIR from wrapper location
   - export server.env defaults
   - exec "$DIR/node_modules/.bin/{server.bin}" "$@"
4. Make wrapper executable.
5. Do not print logs to stdout in generated wrappers.
6. Add tests for wrapper content.
7. Add tests for executable permissions if feasible on Linux.

Acceptance:
- npm test passes.
- npm run build passes.
- generated wrapper content is deterministic.
```

---

## Phase 4: Generate client configs

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 4 only: client config generation.

Requirements:
1. Add src/build/generateClientConfigs.ts.
2. Add generators:
   - src/clients/genericJson.ts
   - src/clients/claudeDesktop.ts
   - src/clients/codexToml.ts
   - src/clients/cursorJson.ts
3. Use __MCP_BUNDLE_DIR__/bin/{server.name} as command path.
4. Include args and env from manifest.
5. Generate files under configs/.
6. Add tests for all config generators.

Acceptance:
- npm test passes.
- npm run build passes.
- generated JSON is valid.
- generated TOML is syntactically valid or at least deterministic and documented.
```

---

## Phase 5: Build pipeline without npm install

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 5 only: build pipeline without dependency installation.

Requirements:
1. Add src/build/buildBundle.ts.
2. Implement build command orchestration:
   - clear workdir
   - load manifest
   - validate manifest
   - copy manifest into bundle as manifest.yaml
   - generate package.json
   - generate wrappers
   - generate configs
   - generate README
3. Add src/build/generateReadme.ts.
4. Do not run npm install yet.
5. Add CLI build command.
6. Add integration-style test using a temporary directory.

Acceptance:
- npm test passes.
- npm run build passes.
- build command creates expected directory structure.
```

---

## Phase 6: Install dependencies and smoke tests

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 6 only: npm dependency installation and smoke tests.

Requirements:
1. Add src/build/installDependencies.ts.
2. Add src/build/runSmokeTests.ts.
3. installDependencies should:
   - run npm ci --omit=dev if package-lock.json exists
   - otherwise run npm install --omit=dev
   - merge install.env into process env
   - default PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
4. runSmokeTests should:
   - execute each generated wrapper with server.smokeTestArgs
   - default smokeTestArgs to ["--help"]
   - use timeout 20 seconds
   - fail build on non-zero exit
5. Add tests with mocked process execution.
6. Do not run real browser tests.

Acceptance:
- npm test passes.
- npm run build passes.
- mocked install and smoke test behavior is covered.
```

---

## Phase 7: Archive and checksums

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 7 only: archive and checksum generation.

Requirements:
1. Add src/build/createArchive.ts.
2. Add src/build/generateChecksums.ts.
3. Create tar.gz archive under dist/.
4. Archive root directory must be mcp-offline-bundle/.
5. Generate checksums.txt with SHA256.
6. Include checksums.txt in dist.
7. Add pack command.
8. Add tests for checksum format and archive presence.

Acceptance:
- npm test passes.
- npm run build passes.
- build command produces tar.gz and checksums.txt.
```

---

## Phase 8: GitHub Actions

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 8 only: GitHub Actions workflow.

Requirements:
1. Add .github/workflows/build.yml.
2. Trigger on:
   - push to main
   - workflow_dispatch
3. Use Node.js 20.
4. Run:
   - npm ci
   - npm run lint
   - npm test
   - npm run build
   - npm run bundle
5. Upload dist/*.tar.gz and dist/checksums.txt as artifact.
6. Set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1.
7. Keep permissions minimal.

Acceptance:
- workflow YAML is valid.
- all referenced npm scripts exist.
```

---

## Phase 9: Example manifest for browser MCPs

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 9 only: example manifest and documentation.

Requirements:
1. Add examples/browser-mcps/mcp.manifest.yaml.
2. Include chrome-devtools-mcp and @playwright/mcp.
3. Do not use latest.
4. If exact versions are unknown, run npm view to find current versions, then pin them.
5. Add README instructions for:
   - building locally
   - downloading artifact
   - unpacking in WSL
   - starting Windows Chrome remote debugging
   - configuring MCP clients
   - checking sha256
6. Add FAQ.

Acceptance:
- README is clear enough for a new user.
- example manifest validates.
```

---

## Phase 10: End-to-end verification

Prompt:

```text
Read docs/PRD.md and AGENTS.md.

Implement Phase 10 only: end-to-end verification.

Requirements:
1. Run the full build using examples/browser-mcps/mcp.manifest.yaml.
2. Verify tar.gz exists.
3. Verify checksums.txt validates.
4. Extract archive into a temp directory.
5. Verify bin/chrome-devtools --help works.
6. Verify bin/playwright --help works.
7. Document any limitation or failure honestly.
8. Do not connect to a real browser in CI.

Acceptance:
- Full build succeeds on ubuntu-latest.
- Extracted bundle contains node_modules, bin, configs, README.md.
- Both MCP wrapper smoke tests pass.
```

---

## One-shot prompt after scaffold is ready

Use this only after the repo already contains PRD and AGENTS.md:

```text
You are implementing mcp-offline-bundler.

Read:
- docs/PRD.md
- AGENTS.md
- existing source code

Task:
Implement the next incomplete phase from docs/DEVELOPMENT_PLAN.md.

Rules:
1. Do not skip phases.
2. Do not broaden scope beyond the PRD.
3. Keep MVP linux-x64 only.
4. Do not add browser downloads.
5. Do not allow latest versions.
6. Add or update tests for every change.
7. Run npm test and npm run build.
8. Summarize changed files, test results, and remaining work.

Start by identifying the next incomplete phase.
```

---

## Recommended manual development order

```text
Day 1:
  Phase 0
  Phase 1
  Phase 2

Day 2:
  Phase 3
  Phase 4
  Phase 5

Day 3:
  Phase 6
  Phase 7
  Phase 8

Day 4:
  Phase 9
  Phase 10
  polish README
```

## Human review checklist

Before accepting an agent patch, check:

```text
[ ] Did it keep linux-x64 only?
[ ] Did it avoid latest?
[ ] Did it avoid browser downloads?
[ ] Did it avoid stdout logs in wrappers?
[ ] Did it add tests?
[ ] Did npm test pass?
[ ] Did npm run build pass?
[ ] Did generated configs use __MCP_BUNDLE_DIR__ placeholder?
[ ] Did it avoid committing dist/ and node_modules/?
[ ] Did it avoid adding secrets or local absolute paths?
```
