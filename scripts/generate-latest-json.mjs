import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const versionInput = argValue("--version");
const bundleDir = argValue("--bundle-dir");
const outputPath = argValue("--output-path");

if (!versionInput || !bundleDir || !outputPath) {
  console.error("Usage: node scripts/generate-latest-json.mjs --version v0.0.0 --bundle-dir <dir> --output-path <file>");
  process.exit(1);
}

const version = versionInput.startsWith("v") ? versionInput : `v${versionInput}`;
const jsonVersion = version.replace(/^v/, "");
const repo = process.env.GITHUB_REPO || "OWNER/REPO";
const baseUrl = `https://github.com/${repo}/releases/download/${version}`;
const platforms = {};

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function githubAssetName(filePath) {
  return basename(filePath).replaceAll(" ", ".");
}

function readSignature(filePath) {
  const sigPath = `${filePath}.sig`;
  if (!existsSync(sigPath)) {
    throw new Error(`Signature file not found: ${sigPath}`);
  }
  return readFileSync(sigPath, "utf8").trim();
}

function platformKey(filePath) {
  const lower = filePath.replaceAll("\\", "/").toLowerCase();
  const name = basename(lower);
  const extension = extname(name);

  if (lower.includes("/nsis/") && extension === ".exe") return "windows-x86_64";
  if (lower.includes("/msi/") && extension === ".msi") return "windows-x86_64-msi";
  if (extension === ".dmg") {
    if (lower.includes("aarch64") || lower.includes("arm64") || lower.includes("apple-silicon")) return "darwin-aarch64";
    if (lower.includes("x64") || lower.includes("x86_64") || lower.includes("intel")) return "darwin-x86_64";
    return process.env.TAURI_TARGET_PLATFORM || "darwin-aarch64";
  }
  if (extension === ".appimage" || extension === ".deb") {
    if (lower.includes("aarch64") || lower.includes("arm64")) return "linux-aarch64";
    return "linux-x86_64";
  }
  return undefined;
}

const artifacts = walk(resolve(bundleDir)).filter((file) => {
  const extension = extname(file).toLowerCase();
  return [".exe", ".msi", ".dmg", ".appimage", ".deb"].includes(extension);
});

for (const artifact of artifacts) {
  const key = platformKey(artifact);
  if (!key || platforms[key]) continue;
  platforms[key] = {
    signature: readSignature(artifact),
    url: `${baseUrl}/${githubAssetName(artifact)}`,
  };
  console.log(`Registered ${key}: ${githubAssetName(artifact)}`);
}

if (Object.keys(platforms).length === 0) {
  throw new Error(`No signed updater artifacts found in ${bundleDir}`);
}

const manifest = {
  version: jsonVersion,
  notes: "See release notes for details",
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated update manifest: ${outputPath}`);
