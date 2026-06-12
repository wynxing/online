# 构建与部署

本文档说明项目的本地构建、sidecar 打包、CI/CD 发布和自动更新 manifest 生成流程。

## 构建产物

| 产物 | 平台 | 说明 |
|------|------|------|
| Python Runtime sidecar | Windows/macOS/Linux | PyInstaller 打包的独立运行时，可执行文件随 Tauri bundle 分发 |
| NSIS / MSI | Windows x64 | Windows 安装包 |
| DMG / app bundle | macOS x64/arm64 | macOS 安装与应用包 |
| AppImage / DEB | Linux x64 | Linux 桌面分发包 |
| `latest.json` | 全平台 | Tauri updater 使用的多平台更新 manifest |

## 本地构建

### 前置条件

- Node.js 22+
- Python 3.10+
- Rust stable
- 当前平台的 Tauri 系统依赖
- Linux 需要 PortAudio 与 WebKitGTK 相关开发库，例如 CI 中使用的 `portaudio19-dev`、`libwebkit2gtk-4.1-dev` 等

### 构建 Python Runtime sidecar

```bash
npm run runtime:sidecar
```

该命令调用 `scripts/build-runtime-sidecar.mjs`，运行 PyInstaller，并根据当前平台或 `TARGET_TRIPLE` 环境变量输出 Tauri sidecar 文件：

```text
apps/desktop/src-tauri/binaries/ai-interpretation-runtime-{targetTriple}[.exe]
```

常用 target triple：

| 平台 | target triple |
|------|---------------|
| Windows x64 | `x86_64-pc-windows-msvc` |
| macOS x64 | `x86_64-apple-darwin` |
| macOS arm64 | `aarch64-apple-darwin` |
| Linux x64 | `x86_64-unknown-linux-gnu` |

交叉指定示例：

```bash
TARGET_TRIPLE=x86_64-unknown-linux-gnu npm run runtime:sidecar
```

注意：PyInstaller 通常需要在目标 OS 上构建对应 sidecar，不建议依赖跨 OS 交叉打包。

### 完整本地 Release 构建

```bash
npm run release:local
```

该命令调用 `scripts/build-release-local.mjs`，依次执行：

1. `npm install`
2. `python -m pip install -r runtime/requirements.txt`
3. `npm run runtime:sidecar`
4. `npm run tauri -- build`

## CI/CD

### CI workflow

`.github/workflows/ci.yml` 包含三类检查：

- Frontend：`npm ci`、lint、TypeScript/Vite build、Vitest
- Runtime：安装 Python 依赖、Ruff、pytest coverage
- Sidecar matrix：在 Windows x64、macOS x64、macOS arm64、Linux x64 上分别构建 PyInstaller sidecar

### Release workflow

`.github/workflows/release.yml` 在推送 `v*` tag 或手动触发时运行。

Build matrix：

| Job | Runner | target |
|-----|--------|--------|
| Windows x64 | `windows-latest` | `x86_64-pc-windows-msvc` |
| macOS x64 | `macos-15-intel` | `x86_64-apple-darwin` |
| macOS arm64 | `macos-15` | `aarch64-apple-darwin` |
| Linux x64 | `ubuntu-latest` | `x86_64-unknown-linux-gnu` |

每个平台 job 会：

1. 安装 Node、Python、Rust 与平台依赖
2. 运行前端 lint/test
3. 运行 Runtime lint/test
4. 构建 Python sidecar
5. 执行 `tauri build --target {target}`
6. 上传 bundle artifact

Publish job 会下载所有平台 artifact，调用 `scripts/generate-latest-json.mjs` 生成统一 `latest.json`，然后把安装包、签名文件和 manifest 上传到 GitHub Releases。

## Updater manifest

`latest.json` 由 `scripts/generate-latest-json.mjs` 生成，按文件类型和路径推断平台 key：

| 产物 | updater platform key |
|------|----------------------|
| NSIS `.exe` | `windows-x86_64` |
| MSI `.msi` | `windows-x86_64-msi` |
| macOS arm64 `.dmg` | `darwin-aarch64` |
| macOS x64 `.dmg` | `darwin-x86_64` |
| Linux x64 AppImage/DEB | `linux-x86_64` |

手动生成示例：

```bash
GITHUB_REPO=owner/repo node scripts/generate-latest-json.mjs \
  --version v0.4.13 \
  --bundle-dir apps/desktop/src-tauri/target/release/bundle \
  --output-path apps/desktop/src-tauri/target/release/bundle/latest.json
```

## 音频平台依赖

- Windows：使用 `pyaudiowpatch` 枚举并采集 WASAPI loopback。
- macOS：使用 `sounddevice`/PortAudio；系统音频需要 BlackHole、Loopback、Soundflower 等虚拟输入设备。
- Linux：使用 `sounddevice`/PortAudio；系统音频优先使用 PulseAudio/PipeWire monitor source。
- 没有可用真实设备时，Runtime 返回 mock 设备，应用可继续启动用于演示或前端开发。

## 发布流程

```bash
git checkout main
git pull origin main
npm run version:bump
git add -A
git commit -m "chore: release v0.4.13"
git tag v0.4.13
git push origin main --tags
```

推送 tag 后，GitHub Actions 会构建多平台安装包并发布到 Releases。

## 目录约定

| 路径 | 用途 |
|------|------|
| `apps/desktop/src-tauri/binaries/` | PyInstaller sidecar 输出位置 |
| `apps/desktop/src-tauri/target/*/release/bundle/` | Tauri 平台 bundle 输出 |
| `dist/` | PyInstaller 输出目录 |
| `~/.online/` | 运行时数据目录 |
