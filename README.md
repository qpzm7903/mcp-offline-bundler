# mcp-offline-bundler

A CLI tool that builds **offline runtime bundles** for npm-based
[MCP](https://modelcontextprotocol.io) servers.

The idea: build the bundle once on an online machine (or in CI), copy the
resulting `tar.gz` to an offline / restricted-network environment, unpack it,
and run the MCP servers locally over stdio — no public npm registry access
needed at run time.

## Scope (MVP)

Supported:

- `linux-x64` only (WSL2 / Linux)
- Node.js `>=20`
- `npm`
- npm-package-based MCP servers
- `stdio` transport
- `tar.gz` output

Not supported (by design): Windows/macOS bundle output, embedding
Chrome/Chromium, downloading Playwright browsers, editing your MCP client
config files in place, private npm auth, and any GUI.

## Install / develop

```bash
npm install
npm run lint
npm test
npm run build      # compile TypeScript to dist/
```

## CLI commands

```bash
mcp-offline-bundler init                                   # write a sample mcp.manifest.yaml
mcp-offline-bundler validate -m mcp.manifest.yaml          # validate a manifest (no install)
mcp-offline-bundler build -m mcp.manifest.yaml --out dist  # full build pipeline
mcp-offline-bundler pack --workdir dist/work/bundle --out dist  # archive an existing workdir
mcp-offline-bundler print-config -m mcp.manifest.yaml --client generic  # print a client config
```

During development, run via `node dist/cli.js <command>` after `npm run build`,
or use the convenience scripts:

```bash
npm run cli -- validate -m mcp.manifest.yaml
npm run bundle     # build using the repo-root mcp.manifest.yaml into dist/
```

## The manifest

The manifest is the source of truth for what goes into a bundle. Generate a
starting point with `mcp-offline-bundler init`, then edit it. A worked example
lives at [`examples/browser-mcps/mcp.manifest.yaml`](examples/browser-mcps/mcp.manifest.yaml).

Rules enforced by `validate`:

- `bundle.target` must be `linux-x64`.
- Every `server` needs `name`, `package`, `version`, `bin`, and `transport: stdio`.
- `server.version` **must be exact** — `latest`, `*`, `^1.2.3`, `~1.2.3`,
  `>=1.2.3` are all rejected. Only `1.2.3` / `1.2.3-beta.1` style versions pass.
- `server.name` must match `^[a-z0-9-]+$`, and names must be unique.

To pin a current version, look it up first:

```bash
npm view chrome-devtools-mcp version
npm view @playwright/mcp version
```

## Build locally

```bash
mcp-offline-bundler build -m examples/browser-mcps/mcp.manifest.yaml --out dist
```

This clears the workdir, validates the manifest, generates a runtime
`package.json`, installs dependencies with npm (omitting dev deps,
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` by default), generates wrappers and client
configs, generates the bundle README, runs `--help` smoke tests, creates
`dist/<archiveName>.tar.gz`, and writes `dist/checksums.txt`.

The build runs `npm install` for the bundled servers, so this step needs
network access. Run it on an online machine, then copy the archive to the
offline target.

## Build in CI (GitHub Actions)

Pushing changes to the repo-root `mcp.manifest.yaml`, `src/**`, `templates/**`,
`package.json`, `package-lock.json`, or the workflow itself triggers
[`.github/workflows/build.yml`](.github/workflows/build.yml) on `main`. It also
supports `workflow_dispatch`. The workflow runs lint, tests, build, and
`npm run bundle`, then uploads `dist/*.tar.gz` and `dist/checksums.txt` as a
build artifact.

## Download the artifact

1. Open the repository's **Actions** tab on GitHub.
2. Select the most recent successful **Build MCP Offline Bundle** run.
3. Download the **mcp-offline-bundle-linux-x64** artifact (a `.zip`).
4. Unzip it to get `mcp-offline-bundle-linux-x64.tar.gz` and `checksums.txt`.

## Verify the checksum

Before extracting, verify integrity (run from the directory holding both files):

```bash
sha256sum -c checksums.txt
```

You should see `mcp-offline-bundle-linux-x64.tar.gz: OK`.

## Unpack in WSL / Linux

```bash
mkdir -p ~/tools
tar -xzf mcp-offline-bundle-linux-x64.tar.gz -C ~/tools
```

The bundle root is then `~/tools/mcp-offline-bundle/`, containing:

```text
mcp-offline-bundle/
  README.md
  manifest.yaml
  package.json
  package-lock.json
  node_modules/
  bin/
  configs/
  checksums.txt
```

The wrappers in `bin/` locate the bundle directory relative to themselves and
exec `node_modules/.bin/<bin>`, so the bundle is relocatable — just keep the
directory structure intact.

## Start Windows Chrome remote debugging

The browser MCP servers do **not** ship a browser. They connect to a Chrome you
start yourself over the Chrome DevTools Protocol. From a Windows PowerShell
prompt, start Chrome with a dedicated, throwaway profile:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\chrome-debug-profile"
```

From inside WSL, confirm you can reach it:

```bash
curl http://127.0.0.1:9222/json/version
```

If `127.0.0.1` does not work from WSL, find the Windows host IP from the
`nameserver` line of `/etc/resolv.conf` and use that IP in the server's
`--browser-url` / `--cdp-endpoint` argument instead.

## Configure MCP clients

The bundle ships ready-to-edit snippets under `configs/`:

- `configs/generic-mcp.json` — generic MCP JSON
- `configs/claude-desktop.json` — Claude Desktop
- `configs/codex.toml` — Codex
- `configs/cursor.json` — Cursor

Each uses the placeholder `__MCP_BUNDLE_DIR__/bin/<server>` as the command.
Replace `__MCP_BUNDLE_DIR__` with the absolute path to the extracted bundle
(e.g. `/home/yourname/tools/mcp-offline-bundle`), then paste the snippet into
your client's config file. Example for a generic client:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "/home/yourname/tools/mcp-offline-bundle/bin/chrome-devtools",
      "args": [
        "--browser-url=http://127.0.0.1:9222",
        "--no-usage-statistics",
        "--no-performance-crux"
      ],
      "env": {
        "CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS": "1",
        "CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS": "1"
      }
    }
  }
}
```

This tool never edits your client config files for you.

You can also print a config without unpacking a bundle:

```bash
mcp-offline-bundler print-config -m examples/browser-mcps/mcp.manifest.yaml --client codex
```

## Security notes

Remote debugging exposes full control of a browser. Treat it carefully:

- Use a **separate, dedicated Chrome profile** for remote debugging
  (`--user-data-dir` above), never your day-to-day profile.
- Do not log into sensitive or company accounts in that profile.
- Do not open company-internal systems or private pages while debugging.
- Only enable remote debugging on a trusted local machine or trusted network.
- Close the remote-debugging Chrome instance when you are finished.

Bundles never include secrets: `.npmrc` tokens, `.env` files, SSH keys, browser
profile data, and local absolute paths are all kept out of the archive.

## FAQ

**Does the bundle download a browser?**
No. Browser binaries are never bundled or downloaded; Playwright browser
downloads are skipped via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

**Do I need network access to *use* a bundle?**
No. All npm dependencies are vendored under `node_modules/`. Network is only
needed at *build* time. The build step runs `npm install`.

**Can I run a bundle on Windows or macOS directly?**
No. The MVP targets `linux-x64` only. On Windows, use WSL2.

**Why is `latest` rejected?**
Reproducibility. Pinning exact versions keeps every team member's bundle
identical and auditable. Use `npm view <package> version` to pin.

**Why is the command path a placeholder?**
The bundle does not know where you will extract it, so configs ship with the
`__MCP_BUNDLE_DIR__` placeholder for you to replace with an absolute path.

**A smoke test failed during build — what does that mean?**
The build runs each wrapper with `--help` (or the manifest's `smokeTestArgs`)
to confirm the server is installed and launchable. A failure means the package
is broken, the `bin` name is wrong, or the Node version is unsupported. Smoke
tests never connect to a real browser.
