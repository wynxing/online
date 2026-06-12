import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

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

run("npm", ["install"]);
run("python", ["-m", "pip", "install", "-r", "runtime/requirements.txt"]);
run("node", ["scripts/build-runtime-sidecar.mjs"]);
run("npm", ["run", "tauri", "--", "build"]);
