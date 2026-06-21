import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkVersionConsistency } from "./check-version-consistency.mjs";

function fixture(version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "online-version-test-"));
  mkdirSync(join(root, "apps/desktop/src-tauri"), { recursive: true });
  writeFileSync(join(root, "apps/desktop/package.json"), JSON.stringify({ version }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "apps/desktop": { version } } })
  );
  writeFileSync(
    join(root, "apps/desktop/src-tauri/tauri.conf.json"),
    JSON.stringify({ version })
  );
  writeFileSync(join(root, "apps/desktop/src-tauri/Cargo.toml"), `[package]\nversion = "${version}"\n`);
  writeFileSync(
    join(root, "apps/desktop/src-tauri/Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "ai-interpretation-desktop"\nversion = "${version}"\n`
  );
  return root;
}

function withFixture(run) {
  const root = fixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts consistent project versions", () => {
  withFixture((root) => {
    assert.equal(checkVersionConsistency(root).expected, "1.2.3");
    assert.equal(checkVersionConsistency(root, "1.2.3").expected, "1.2.3");
  });
});

test("reports every version source when one drifts", () => {
  withFixture((root) => {
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({ packages: { "apps/desktop": { version: "1.2.2" } } })
    );
    assert.throws(
      () => checkVersionConsistency(root),
      /package-lock\.json workspace: 1\.2\.2/
    );
  });
});

test("rejects a release version that differs from project metadata", () => {
  withFixture((root) => {
    assert.throws(() => checkVersionConsistency(root, "2.0.0"), /Expected 2\.0\.0/);
  });
});

test("rejects missing and invalid versions", () => {
  withFixture((root) => {
    writeFileSync(join(root, "apps/desktop/package.json"), JSON.stringify({}));
    assert.throws(() => checkVersionConsistency(root), /Version is missing/);
  });
  withFixture((root) => {
    assert.throws(() => checkVersionConsistency(root, "release"), /not valid SemVer/);
  });
});
