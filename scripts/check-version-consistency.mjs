import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function packageVersionFromToml(content, packageName) {
  const blocks = content.split("[[package]]").slice(1);
  for (const block of blocks) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    if (name === packageName) {
      const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
      if (version) return version;
    }
  }
  throw new Error(`Package ${packageName} was not found in Cargo.lock`);
}

function packageVersionFromManifest(content) {
  const packageSection = content.match(/\[package\]([\s\S]*?)(?=\r?\n\[|$)/)?.[1];
  const version = packageSection?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error("Package version was not found in Cargo.toml");
  return version;
}

export function readProjectVersions(rootDir) {
  const desktopPackage = JSON.parse(
    readFileSync(resolve(rootDir, "apps/desktop/package.json"), "utf8")
  );
  const packageLock = JSON.parse(readFileSync(resolve(rootDir, "package-lock.json"), "utf8"));
  const tauriConfig = JSON.parse(
    readFileSync(resolve(rootDir, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")
  );
  const cargoToml = readFileSync(resolve(rootDir, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(resolve(rootDir, "apps/desktop/src-tauri/Cargo.lock"), "utf8");

  const versions = {
    "apps/desktop/package.json": desktopPackage.version,
    "package-lock.json workspace": packageLock.packages?.["apps/desktop"]?.version,
    "apps/desktop/src-tauri/tauri.conf.json": tauriConfig.version,
    "apps/desktop/src-tauri/Cargo.toml": packageVersionFromManifest(cargoToml),
    "apps/desktop/src-tauri/Cargo.lock": packageVersionFromToml(
      cargoLock,
      "ai-interpretation-desktop"
    ),
  };

  for (const [source, version] of Object.entries(versions)) {
    if (typeof version !== "string" || !version) {
      throw new Error(`Version is missing from ${source}`);
    }
  }
  return versions;
}

export function checkVersionConsistency(rootDir, expectedVersion) {
  const versions = readProjectVersions(rootDir);
  const canonical = versions["apps/desktop/package.json"];
  const expected = expectedVersion || canonical;

  if (!SEMVER_PATTERN.test(expected)) {
    throw new Error(`Expected version is not valid SemVer: ${expected}`);
  }

  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length > 0) {
    const details = Object.entries(versions)
      .map(([source, version]) => `  ${source}: ${version}`)
      .join("\n");
    throw new Error(`Version mismatch. Expected ${expected}:\n${details}`);
  }
  return { expected, versions };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const result = checkVersionConsistency(rootDir, argumentValue("--expected"));
    console.log(`Version consistency check passed: ${result.expected}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
