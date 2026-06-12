import { copyFileSync, chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { arch, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const sidecarBaseName = "ai-interpretation-runtime";

function targetTriple() {
  if (process.env.TARGET_TRIPLE) {
    return process.env.TARGET_TRIPLE;
  }
  if (process.env.TARGET) {
    return process.env.TARGET;
  }

  const os = platform();
  const cpu = arch();
  if (os === "win32" && cpu === "x64") return "x86_64-pc-windows-msvc";
  if (os === "win32" && cpu === "arm64") return "aarch64-pc-windows-msvc";
  if (os === "darwin" && cpu === "x64") return "x86_64-apple-darwin";
  if (os === "darwin" && cpu === "arm64") return "aarch64-apple-darwin";
  if (os === "linux" && cpu === "x64") return "x86_64-unknown-linux-gnu";
  if (os === "linux" && cpu === "arm64") return "aarch64-unknown-linux-gnu";

  throw new Error(`Unsupported runtime sidecar platform: ${os}/${cpu}`);
}

function run(command, args) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const triple = targetTriple();
const executableName = process.platform === "win32" ? `${sidecarBaseName}.exe` : sidecarBaseName;
const distBinary = join(root, "dist", executableName);
const targetName = triple.includes("windows")
  ? `${sidecarBaseName}-${triple}.exe`
  : `${sidecarBaseName}-${triple}`;
const sidecarDir = join(root, "apps", "desktop", "src-tauri", "binaries");
const sidecarPath = join(sidecarDir, targetName);

rmSync(join(root, "build", sidecarBaseName), { recursive: true, force: true });
run("python", ["-m", "PyInstaller", "--clean", "--noconfirm", join("runtime", "ai-interpretation-runtime.spec")]);

if (!existsSync(distBinary)) {
  throw new Error(`PyInstaller output was not found: ${distBinary}`);
}

mkdirSync(sidecarDir, { recursive: true });
copyFileSync(distBinary, sidecarPath);
if (!triple.includes("windows")) {
  chmodSync(sidecarPath, 0o755);
}

console.log(`Built runtime sidecar: ${basename(sidecarPath)}`);
