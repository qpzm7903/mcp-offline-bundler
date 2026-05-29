# mcp-offline-bundler PRD

## 1. 产品名称

mcp-offline-bundler

## 2. 产品定位

mcp-offline-bundler 是一个面向 MCP 工具的离线运行包构建器。

它通过一个清单文件描述需要打包的 MCP Server，然后在 GitHub Actions 或本地构建环境中自动生成可离线使用的运行包。用户在公司内网、无公网 npm 访问能力的环境中，解压离线包后即可把 MCP Server 配置到 Claude Desktop、Claude Code、Codex、Cursor 等 MCP 客户端中使用。

本项目不定位为通用 npm 镜像工具，不替代 Verdaccio、Nexus、Artifactory，也不做跨操作系统通用离线包。MVP 阶段仅支持 linux-x64，主要面向 WSL / Linux 开发环境。

## 3. 背景与问题

很多 MCP Server 目前常见启动方式是：

```bash
npx -y some-mcp-server@latest
```

这种方式在个人联网环境下简单，但在公司内网、离线环境、受控网络环境下存在以下问题：

1. 运行时需要访问公网 npm registry。
2. 使用 `latest` 导致版本不可控，团队成员环境不一致。
3. MCP Server 依赖可能较多，手工下载、拷贝、解压、配置容易出错。
4. 同一个团队需要多个 MCP Server 时，离线包制作流程重复。
5. 不同 MCP 客户端的配置格式不同，人工配置容易写错。
6. Playwright 类工具可能自动下载浏览器，导致离线安装失败或产物过大。
7. 缺乏统一的 smoke test、checksum、版本清单和安装说明。

因此需要一个清单驱动的构建器，把“选择 MCP 工具、固定版本、安装依赖、生成 wrapper、生成客户端配置、压缩出包、校验产物”自动化。

## 4. 目标用户

### 4.1 个人开发者

在 WSL / Linux 中开发 Web 应用，但公司内网无法直接访问 npm，希望提前生成离线包，放到内网环境使用。

### 4.2 企业研发团队

团队中多人需要使用同一组 MCP 工具，希望版本统一、产物可追溯、配置标准化。

### 4.3 内网工具维护者

负责维护公司内部 AI 开发工具链，希望通过 GitHub Actions 或类似 CI 系统自动生成 MCP 离线包，并发给团队使用。

## 5. 典型使用场景

### 场景一：WSL 开发 Web 应用，Windows 宿主机 Chrome 测试

用户在 WSL 中运行 MCP Server，在 Windows 宿主机中启动 Chrome remote debugging 端口。

需要离线打包：

1. chrome-devtools-mcp
2. @playwright/mcp

要求：

1. 离线包不内置 Chrome。
2. Playwright 不自动下载浏览器。
3. 两个 MCP Server 默认连接 `http://127.0.0.1:9222` 或用户指定的 Chrome CDP 地址。
4. 产物可直接用于 Claude Code / Codex / Claude Desktop / Cursor。

### 场景二：团队统一发放 MCP 工具包

团队维护一个 `mcp.manifest.yaml`，每次增加或升级 MCP 工具，只修改清单文件。GitHub Actions 自动构建并上传 artifact。

### 场景三：公司内网机器解压使用

用户在内网机器执行：

```bash
tar -xzf mcp-offline-bundle-linux-x64.tar.gz -C ~/tools
```

然后把生成的 MCP 客户端配置片段复制到自己的客户端配置文件中。

## 6. 产品目标

### 6.1 MVP 目标

MVP 需要完成以下能力：

1. 读取 `mcp.manifest.yaml`。
2. 校验清单内容。
3. 禁止使用 `latest`、`*`、`^`、`~` 等不确定版本。
4. 根据清单生成 runtime `package.json`。
5. 使用 npm 安装指定 MCP Server 依赖。
6. 支持通过环境变量跳过 Playwright 浏览器下载。
7. 生成本地 wrapper 脚本。
8. 生成 Claude Desktop / Codex / 通用 MCP JSON 配置片段。
9. 对每个 MCP Server 执行 smoke test，例如 `--help`。
10. 生成 tar.gz 离线包。
11. 生成 SHA256 checksum。
12. 通过 GitHub Actions 自动上传 artifact。
13. 输出清晰的安装使用说明。

### 6.2 非目标

MVP 不做以下事情：

1. 不支持 Windows 离线包。
2. 不支持 macOS 离线包。
3. 不内置 Chrome、Chromium 或 Playwright 浏览器二进制。
4. 不做完整 npm registry。
5. 不做 MCP Server 的功能测试，只做可执行性 smoke test。
6. 不自动修改用户本机 MCP 客户端配置文件。
7. 不处理企业代理、证书、私有 registry 登录。
8. 不实现 GUI。
9. 不支持动态在线更新。
10. 不支持任意 shell 脚本作为 MCP Server，MVP 只支持 npm package 类型。

## 7. 运行环境约束

MVP 固定支持：

```text
OS: linux-x64
推荐环境: WSL2 / Linux
Node.js: >=20
Package manager: npm
Archive format: tar.gz
Transport target: stdio MCP Server
```

如果用户在 Windows 或 macOS 使用，本项目不保证可用。

## 8. 用户体验目标

用户理想体验如下：

### 8.1 修改清单

```yaml
bundle:
  name: browser-mcp-offline-bundle
  target: linux-x64
  node: ">=20"
  archiveName: mcp-offline-bundle-linux-x64

install:
  packageManager: npm
  omitDev: true
  env:
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"

servers:
  - name: chrome-devtools
    package: chrome-devtools-mcp
    version: "0.18.1"
    bin: chrome-devtools-mcp
    transport: stdio
    args:
      - "--browser-url=http://127.0.0.1:9222"
      - "--no-usage-statistics"
      - "--no-performance-crux"
    env:
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1"
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1"
    smokeTestArgs:
      - "--help"

  - name: playwright
    package: "@playwright/mcp"
    version: "0.0.75"
    bin: playwright-mcp
    transport: stdio
    args:
      - "--cdp-endpoint=http://127.0.0.1:9222"
    env:
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
    smokeTestArgs:
      - "--help"

clients:
  claudeDesktop: true
  codex: true
  cursor: true
  genericJson: true
```

### 8.2 本地构建

```bash
npm install
npm run build
npm run bundle
```

或者：

```bash
npx mcp-offline-bundler build -m mcp.manifest.yaml --out dist
```

### 8.3 CI 构建

用户 push 清单文件后，GitHub Actions 自动生成：

```text
dist/
  mcp-offline-bundle-linux-x64.tar.gz
  checksums.txt
```

### 8.4 内网使用

用户解压后看到：

```text
mcp-offline-bundle/
  README.md
  manifest.yaml
  package.json
  package-lock.json
  node_modules/
  bin/
    chrome-devtools
    playwright
  configs/
    claude-desktop.json
    codex.toml
    cursor.json
    generic-mcp.json
  checksums.txt
```

然后复制配置：

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
    },
    "playwright": {
      "command": "/home/yourname/tools/mcp-offline-bundle/bin/playwright",
      "args": [
        "--cdp-endpoint=http://127.0.0.1:9222"
      ],
      "env": {
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"
      }
    }
  }
}
```

## 9. 功能需求

### 9.1 清单文件解析

系统必须支持读取 YAML 格式清单文件。

默认文件名：

```text
mcp.manifest.yaml
```

清单包括：

1. bundle 元信息。
2. install 配置。
3. servers 列表。
4. clients 配置。

### 9.2 清单校验

必须校验：

1. `bundle.name` 必填。
2. `bundle.target` 必须为 `linux-x64`。
3. `bundle.node` 必填。
4. `servers` 至少包含 1 个 MCP Server。
5. 每个 server 必须包含 `name`、`package`、`version`、`bin`。
6. `name` 只能包含小写字母、数字、连字符。
7. `version` 必须是确定版本，不允许 `latest`、`*`、`^1.0.0`、`~1.0.0`、空值。
8. `transport` MVP 只允许 `stdio`。
9. `args` 必须是字符串数组。
10. `env` 必须是 key-value 字符串对象。
11. `smokeTestArgs` 必须是字符串数组。
12. 不允许两个 server 使用相同的 `name`。
13. 不允许生成 wrapper 时覆盖已有文件名。

校验失败时，应输出清晰错误，例如：

```text
Invalid manifest:
- servers[0].version must be an exact version, but got "latest".
- servers[1].name must match /^[a-z0-9-]+$/.
```

### 9.3 生成 runtime package.json

根据清单生成：

```json
{
  "name": "mcp-offline-bundle-runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "chrome-devtools-mcp": "0.18.1",
    "@playwright/mcp": "0.0.75"
  }
}
```

package.json 生成目录：

```text
dist/work/bundle/package.json
```

### 9.4 安装依赖

MVP 支持 npm。

默认行为：

1. 如果存在可用 `package-lock.json`，优先使用 `npm ci --omit=dev`。
2. 如果不存在 lockfile，使用 `npm install --omit=dev` 生成 lockfile。
3. 安装时注入 manifest 中的 `install.env`。
4. 默认设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，避免 Playwright 下载浏览器。
5. 安装失败时输出 npm 命令、退出码和关键日志。

### 9.5 生成 wrapper 脚本

每个 server 生成一个 wrapper：

```text
bin/{server.name}
```

例如：

```text
bin/chrome-devtools
bin/playwright
```

wrapper 内容要求：

1. 使用 bash。
2. 能定位自身所在目录。
3. 通过相对路径找到 `node_modules/.bin/{bin}`。
4. 注入 server.env 默认环境变量。
5. 支持用户运行时覆盖环境变量。
6. 把用户传入参数原样传给底层 MCP Server。
7. 不在 stdout 输出任何日志，避免破坏 MCP stdio 协议。
8. 错误日志只能输出到 stderr。

wrapper 示例：

```bash
#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

export CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS="${CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS:-1}"
export CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS="${CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:-1}"

exec "$DIR/node_modules/.bin/chrome-devtools-mcp" "$@"
```

### 9.6 生成客户端配置

MVP 至少生成：

```text
configs/generic-mcp.json
configs/claude-desktop.json
configs/codex.toml
configs/cursor.json
```

所有配置中的 command 使用占位路径：

```text
__MCP_BUNDLE_DIR__/bin/{server.name}
```

同时 README 中说明用户需要替换为真实路径。

generic-mcp.json 示例：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "__MCP_BUNDLE_DIR__/bin/chrome-devtools",
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

codex.toml 示例：

```toml
[mcp_servers.chrome-devtools]
command = "__MCP_BUNDLE_DIR__/bin/chrome-devtools"
args = [
  "--browser-url=http://127.0.0.1:9222",
  "--no-usage-statistics",
  "--no-performance-crux"
]

[mcp_servers.chrome-devtools.env]
CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = "1"
CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = "1"
```

### 9.7 smoke test

构建时对每个 server 执行：

```bash
bin/{server.name} {smokeTestArgs}
```

默认 smokeTestArgs 为：

```yaml
smokeTestArgs:
  - "--help"
```

要求：

1. smoke test 只能验证命令是否存在、能否启动、参数是否有效。
2. smoke test 不能连接真实浏览器。
3. smoke test 超时时间默认 20 秒。
4. smoke test stdout/stderr 可以记录到构建日志。
5. smoke test 失败则构建失败。

### 9.8 打包

打包产物：

```text
dist/mcp-offline-bundle-linux-x64.tar.gz
```

压缩包内根目录：

```text
mcp-offline-bundle/
```

必须包含：

```text
README.md
manifest.yaml
package.json
package-lock.json
node_modules/
bin/
configs/
checksums.txt
```

### 9.9 checksum

生成：

```text
dist/checksums.txt
```

内容：

```text
{sha256}  mcp-offline-bundle-linux-x64.tar.gz
```

同时把 checksums.txt 放入压缩包根目录。

### 9.10 README 生成

构建产物内必须包含 README.md，内容至少包括：

1. 包名称。
2. 目标平台。
3. Node.js 版本要求。
4. 包含的 MCP Server 列表。
5. 解压命令。
6. 配置 MCP 客户端的方法。
7. Windows Chrome remote debugging 启动示例。
8. WSL 访问 Windows Chrome 的排查方式。
9. 安全注意事项。
10. checksum 校验方式。
11. 常见问题。

## 10. CLI 设计

项目提供 CLI：

```bash
mcp-offline-bundler <command>
```

### 10.1 init

```bash
mcp-offline-bundler init
```

生成示例清单：

```text
mcp.manifest.yaml
```

### 10.2 validate

```bash
mcp-offline-bundler validate -m mcp.manifest.yaml
```

只校验清单，不安装依赖。

### 10.3 build

```bash
mcp-offline-bundler build -m mcp.manifest.yaml --out dist
```

完整构建流程：

1. 清理工作目录。
2. 读取清单。
3. 校验清单。
4. 生成 runtime package.json。
5. 安装依赖。
6. 生成 wrapper。
7. 生成客户端配置。
8. 生成 README。
9. 执行 smoke test。
10. 打包。
11. 生成 checksum。

### 10.4 pack

```bash
mcp-offline-bundler pack --workdir dist/work/bundle --out dist
```

只对已有 workdir 打包。

### 10.5 print-config

```bash
mcp-offline-bundler print-config -m mcp.manifest.yaml --client generic
```

输出指定客户端配置到 stdout。

## 11. 技术架构

### 11.1 技术栈

推荐：

```text
Runtime: Node.js >=20
Language: TypeScript
CLI framework: commander
YAML parser: yaml
Schema validation: zod
Test framework: vitest
Process execution: execa
Filesystem utility: fs-extra
Archive: tar
TOML generation: smol-toml 或自写简单生成器
Lint/format: eslint + prettier
```

### 11.2 目录结构

```text
mcp-offline-bundler/
  README.md
  LICENSE
  package.json
  tsconfig.json
  vitest.config.ts
  mcp.manifest.yaml
  AGENTS.md
  CLAUDE.md

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

  templates/
    README.bundle.md.hbs
    wrapper.sh.hbs

  examples/
    browser-mcps/
      mcp.manifest.yaml

  tests/
    manifest.test.ts
    generatePackageJson.test.ts
    generateWrappers.test.ts
    generateClientConfigs.test.ts
    createArchive.test.ts

  .github/
    workflows/
      build.yml
```

## 12. GitHub Actions 需求

GitHub Actions 文件：

```text
.github/workflows/build.yml
```

触发条件：

1. push 到 main。
2. 修改 manifest、src、package-lock、workflow 时触发。
3. 支持 workflow_dispatch 手动触发。

流程：

1. checkout。
2. setup-node。
3. npm ci。
4. npm run lint。
5. npm test。
6. npm run build。
7. npm run bundle。
8. 上传 tar.gz 和 checksums.txt artifact。

示例：

```yaml
name: Build MCP Offline Bundle

on:
  push:
    branches:
      - main
    paths:
      - "mcp.manifest.yaml"
      - "src/**"
      - "templates/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/build.yml"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build-linux-x64:
    runs-on: ubuntu-latest

    env:
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install project dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Build CLI
        run: npm run build

      - name: Build offline bundle
        run: npm run bundle

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: mcp-offline-bundle-linux-x64
          path: |
            dist/*.tar.gz
            dist/checksums.txt
          if-no-files-found: error
          retention-days: 30
```

## 13. 安全与合规要求

### 13.1 版本固定

必须禁止不确定版本：

```text
latest
*
^1.0.0
~1.0.0
>=1.0.0
```

只允许：

```text
1.0.0
1.0.0-beta.1
```

### 13.2 不上传敏感信息

artifact 不应包含：

1. `.npmrc` 中的 token。
2. `.env` 文件。
3. SSH key。
4. 用户本机绝对路径。
5. 浏览器 profile 数据。
6. 任何公司内网地址或个人账号信息。

### 13.3 wrapper stdout 限制

wrapper 不允许向 stdout 输出日志。因为 MCP stdio 协议依赖 stdout 传输消息，非协议输出可能破坏客户端通信。

### 13.4 浏览器安全

README 必须提示用户：

1. remote debugging Chrome 必须使用单独 profile。
2. 不要在该 Chrome profile 中登录敏感账号。
3. 不要打开公司敏感系统或个人隐私页面。
4. 仅在可信本机或可信内网使用 remote debugging。
5. 用完关闭 remote debugging Chrome 实例。

## 14. 验收标准

### 14.1 清单校验

给定包含 `latest` 的清单：

```yaml
servers:
  - name: test
    package: test
    version: latest
    bin: test
```

执行：

```bash
npm run cli -- validate -m mcp.manifest.yaml
```

应失败，并提示 exact version 错误。

### 14.2 生成 package.json

给定两个 server：

```yaml
servers:
  - name: a
    package: a
    version: "1.0.0"
    bin: a
  - name: b
    package: "@scope/b"
    version: "2.0.0"
    bin: b
```

应生成：

```json
{
  "dependencies": {
    "a": "1.0.0",
    "@scope/b": "2.0.0"
  }
}
```

### 14.3 wrapper 可执行

构建后：

```bash
ls -l dist/work/bundle/bin
```

每个 wrapper 必须有可执行权限。

### 14.4 配置生成正确

生成的 `generic-mcp.json` 必须包含全部 server，且 command 指向：

```text
__MCP_BUNDLE_DIR__/bin/{server.name}
```

### 14.5 离线包结构正确

压缩包解压后必须包含：

```text
mcp-offline-bundle/bin
mcp-offline-bundle/node_modules
mcp-offline-bundle/configs
mcp-offline-bundle/README.md
mcp-offline-bundle/package.json
mcp-offline-bundle/package-lock.json
```

### 14.6 smoke test 成功

默认示例清单构建时，两个 MCP Server 的 `--help` 都应执行成功。

### 14.7 checksum 可校验

用户执行：

```bash
sha256sum -c checksums.txt
```

应通过。

## 15. 示例清单：浏览器 MCP 离线包

```yaml
bundle:
  name: browser-mcp-offline-bundle
  target: linux-x64
  node: ">=20"
  archiveName: mcp-offline-bundle-linux-x64

install:
  packageManager: npm
  omitDev: true
  env:
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"

servers:
  - name: chrome-devtools
    package: chrome-devtools-mcp
    version: "0.18.1"
    bin: chrome-devtools-mcp
    transport: stdio
    args:
      - "--browser-url=http://127.0.0.1:9222"
      - "--no-usage-statistics"
      - "--no-performance-crux"
    env:
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1"
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1"
    smokeTestArgs:
      - "--help"

  - name: playwright
    package: "@playwright/mcp"
    version: "0.0.75"
    bin: playwright-mcp
    transport: stdio
    args:
      - "--cdp-endpoint=http://127.0.0.1:9222"
    env:
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
    smokeTestArgs:
      - "--help"

clients:
  claudeDesktop: true
  codex: true
  cursor: true
  genericJson: true
```

注意：实际开发时，版本号应通过 npm registry 查询后更新为当前可用的精确版本。

## 16. Roadmap

### V1：个人可用

1. manifest 校验。
2. npm 依赖安装。
3. wrapper 生成。
4. generic config 生成。
5. tar.gz 打包。
6. checksum。
7. GitHub Actions artifact。

### V2：团队可用

1. 支持多 example。
2. 支持 license report。
3. 支持 SBOM。
4. 支持 GitHub Release 发布。
5. 支持更丰富客户端配置。
6. 支持 manifest schema JSON 导出。

### V3：企业增强

1. 支持私有 npm registry。
2. 支持代理配置。
3. 支持 npm cache 离线包。
4. 支持制品签名。
5. 支持依赖漏洞扫描报告。
6. 支持 Linux arm64。
7. 支持 Windows 包，但作为独立 target。
