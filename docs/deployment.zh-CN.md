# 部署

桌面应用由 Tauri 直接打包，无需 Python 运行时构建步骤，也没有 sidecar 二进制。

## 本地发布构建

```powershell
npm run release:local
```

该命令依次执行：

1. `npm install`
2. `npm run tauri -- build`

## CI 发布构建

发布工作流会构建 Windows x64、macOS x64、macOS arm64 和 Linux x64 四个平台的安装包。每个任务会安装 Node 和 Rust，运行前端测试和 Rust 测试，然后调用 Tauri 构建。

Linux 任务会额外安装 Tauri 和音频采集所需的 WebKit、appindicator、SVG、patchelf 和 ALSA 开发包。

## 更新清单

发布时仍会通过 `scripts/generate-latest-json.mjs` 生成 `latest.json`，并与 Tauri 安装包一起上传。
