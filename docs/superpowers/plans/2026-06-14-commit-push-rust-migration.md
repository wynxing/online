# Python-to-Rust Refactoring: Commit & Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate, fix, commit, and push the Python-to-Rust refactoring as a clean PR to main.

**Architecture:** All 90 changed files are currently staged/unstaged on `codex/python-to-rust-runtime` (which points to the same commit as `main`). We need to: fix CRLF issues → stage all remaining changes → verify Rust builds → verify frontend tests → split into logical commits → push → create PR.

**Tech Stack:** Rust/Tauri v2, React/TypeScript, Git, GitHub CLI (`gh`)

---

## Current State Summary

| Category | Count | Status |
|----------|-------|--------|
| Staged files | ~80 | Ready, but some have CRLF warnings |
| Unstaged modifications | 14 | Need `git add` |
| MM files (staged + unstaged) | 7 | Need `git add` to reconcile |
| AM files (added + modified) | 5 | Need `git add` to reconcile |
| Branch commits | 0 | Branch = main, all changes uncommitted |

### Files with unstaged changes (must `git add` before commit)

**MM files** (staged + additional unstaged edits):
- `apps/desktop/src-tauri/Cargo.lock`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ControlPanel.tsx`
- `apps/desktop/src/test/components/ControlPanel.test.tsx`
- `docs/architecture.md`
- `docs/development.md`

**AM files** (newly added + additional unstaged edits):
- `apps/desktop/src-tauri/src/api/mod.rs`
- `apps/desktop/src-tauri/src/audio/mod.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/desktop/src-tauri/src/pipeline/mod.rs`
- `apps/desktop/src-tauri/src/storage/mod.rs`

**Pure unstaged** (never staged):
- `apps/desktop/src/components/SettingsPanel.tsx`
- `apps/desktop/src/types.ts`

---

## Task 1: Fix CRLF Line Endings

**Why:** `.editorconfig` mandates `end_of_line = lf`, but 14 files have CRLF warnings. Commits with mixed line endings cause noisy diffs and cross-platform issues.

**Files:**
- All 14 files listed in git CRLF warnings

- [ ] **Step 1: Normalize all tracked files to LF**

```bash
git add --renormalize .
```

This re-stages files so git stores them with LF internally per `.gitattributes`/`.editorconfig`. The working tree may still show CRLF on Windows, but the repo will be clean.

- [ ] **Step 2: Verify no CRLF warnings remain**

```bash
git diff --cached --name-only 2>&1 | grep -i "crlf\|LF will" || echo "No CRLF warnings"
```

Expected: "No CRLF warnings" or only warnings for files outside our control (like `Cargo.lock` auto-generation).

---

## Task 2: Stage All Remaining Changes

**Why:** There are 14 files with unstaged changes (MM, AM, and pure unstaged) that must be included.

- [ ] **Step 1: Stage all remaining modified/new files**

```bash
git add apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/Cargo.toml apps/desktop/src/App.tsx apps/desktop/src/components/ControlPanel.tsx apps/desktop/src/test/components/ControlPanel.test.tsx docs/architecture.md docs/development.md apps/desktop/src-tauri/src/api/mod.rs apps/desktop/src-tauri/src/audio/mod.rs apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/pipeline/mod.rs apps/desktop/src-tauri/src/storage/mod.rs apps/desktop/src/components/SettingsPanel.tsx apps/desktop/src/types.ts
```

- [ ] **Step 2: Verify staging is clean**

```bash
git status --short | grep "^ M\|^AM\|^MM" || echo "All changes staged"
```

Expected: "All changes staged"

- [ ] **Step 3: Quick sanity check — no unintended deletions**

```bash
git diff --cached --name-only | grep "^runtime/" | wc -l
```

Expected: ~29 (the Python runtime files we intentionally deleted)

---

## Task 3: Verify Rust Build

**Why:** 2,985 lines of Rust have never been compiled. This is the highest-risk gate — if it doesn't build, nothing else matters.

- [ ] **Step 1: Run cargo check**

```bash
cd apps/desktop/src-tauri && cargo check 2>&1
```

Expected: `Finished dev [unoptimized + debuginfo] target(s)` with no errors.

- [ ] **Step 2: If cargo check fails, fix errors**

Read the error output, fix the specific compilation errors, and re-run `cargo check`. Common issues:
- Missing imports
- Type mismatches between modules
- Feature flag differences on Windows vs Linux

- [ ] **Step 3: Run cargo test (if any Rust tests exist)**

```bash
cd apps/desktop/src-tauri && cargo test 2>&1
```

Expected: `test result: ok` (or no test targets, which is also acceptable for a first pass).

---

## Task 4: Verify Frontend Build & Tests

**Why:** Frontend code was migrated from `fetch()`/WebSocket to Tauri `invoke()`/`listen()`. Need to confirm TypeScript compiles and existing tests pass.

- [ ] **Step 1: Install dependencies**

```bash
npm ci
```

- [ ] **Step 2: Run TypeScript type check + Vite build**

```bash
npm run desktop:build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Run frontend lint**

```bash
npm run lint
```

Expected: No new lint errors.

- [ ] **Step 4: Run frontend tests**

```bash
npm run test
```

Expected: All existing tests pass. Note: some tests may need updates because `api.ts` now calls `invoke()` instead of `fetch()` — these should have been updated already in the staged changes.

---

## Task 5: Commit — Phase 1 (Delete Python Runtime)

**Why:** Split commits by logical concern for clean history and easier review.

**Files in this commit:** All deleted `runtime/` files + deleted sidecar build scripts + `FIXES.md`

- [ ] **Step 1: Soft-reset staging area**

```bash
git reset HEAD
```

This unstages everything so we can selectively commit.

- [ ] **Step 2: Stage only the deletions**

```bash
git add -u runtime/
git add -u scripts/build-runtime-sidecar.mjs scripts/build-runtime-sidecar.ps1 scripts/start-runtime.ps1
git add -u FIXES.md
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove Python FastAPI runtime sidecar

Remove the entire runtime/ directory (Python FastAPI backend),
sidecar build scripts, and FIXES.md. This is replaced by the
native Rust/Tauri implementation in the following commits."
```

---

## Task 6: Commit — Phase 2 (Rust Backend)

**Why:** The Rust backend is the core of the migration — separate commit for focused review.

**Files in this commit:**
- `apps/desktop/src-tauri/src/` (all 10 Rust source files)
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/Cargo.lock`
- `apps/desktop/src-tauri/build.rs`
- `apps/desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Stage Rust backend files**

```bash
git add apps/desktop/src-tauri/src/ apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/tauri.conf.json
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: implement native Rust/Tauri backend

Replace Python sidecar with Rust implementation:
- Audio capture: WASAPI loopback (Windows) + cpal (cross-platform)
- ASR: Whisper API + Chat Completions input_audio dual-mode
- Translation: LRU cache, glossary enforcement, context window
- Pipeline: Tokio channel 3-stage (capture -> ASR -> translation)
- Storage: SQLite via rusqlite with WAL mode
- 13 Tauri commands replacing REST API endpoints

Version bumped to 0.5.0."
```

---

## Task 7: Commit — Phase 3 (Frontend Migration)

**Why:** Frontend migration from HTTP/WS to Tauri IPC is a distinct concern.

**Files in this commit:**
- `apps/desktop/src/api.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ControlPanel.tsx`
- `apps/desktop/src/components/SettingsPanel.tsx`
- `apps/desktop/src/hooks/useSubtitleSocket.ts`
- `apps/desktop/src/hooks/useUpdateChecker.ts`
- `apps/desktop/src/types.ts`
- `apps/desktop/src/test/` (all test files)
- `apps/desktop/vite.config.ts`
- `apps/desktop/package.json`

- [ ] **Step 1: Stage frontend files**

```bash
git add apps/desktop/src/api.ts apps/desktop/src/App.tsx apps/desktop/src/components/ControlPanel.tsx apps/desktop/src/components/SettingsPanel.tsx apps/desktop/src/hooks/useSubtitleSocket.ts apps/desktop/src/hooks/useUpdateChecker.ts apps/desktop/src/types.ts apps/desktop/src/test/ apps/desktop/vite.config.ts apps/desktop/package.json
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: migrate frontend from HTTP/WS to Tauri IPC

- api.ts: fetch() -> invoke() for all backend calls
- useSubtitleSocket.ts: WebSocket -> listen() for real-time events
- App.tsx: remove backend readiness polling
- vite.config.ts: remove API proxy configuration
- Update tests to match new Tauri invoke pattern"
```

---

## Task 8: Commit — Phase 4 (Docs & Config)

**Why:** Documentation, CI, and project config changes are auxiliary.

**Files in this commit:**
- `.editorconfig`
- `.github/` (templates, CI, release workflows)
- `.gitignore`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `README.md`, `README.zh-CN.md`
- `docs/` (all documentation files)
- `package.json`, `package-lock.json`
- `scripts/build-release-local.mjs`, `scripts/build-release-local.ps1`

- [ ] **Step 1: Stage remaining files**

```bash
git add .editorconfig .github/ .gitignore CHANGELOG.md CONTRIBUTING.md README.md README.zh-CN.md docs/ package.json package-lock.json scripts/build-release-local.mjs scripts/build-release-local.ps1
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: update documentation, CI, and project config for Rust migration

- Add Chinese translations (zh-CN) for README and docs
- Update CI workflow: add Rust check/test job
- Update release workflow: multi-platform Rust build
- Remove Python sidecar references from build scripts
- Add python-to-rust-refactoring-design.md"
```

---

## Task 9: Verify Clean State & Push

**Why:** Ensure nothing was missed before pushing.

- [ ] **Step 1: Verify working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Verify commit history on branch**

```bash
git log --oneline main..HEAD
```

Expected: 4 commits (Phase 1–4 from Tasks 5–8).

- [ ] **Step 3: Push branch to remote**

```bash
git push -u origin codex/python-to-rust-runtime
```

---

## Task 10: Create Pull Request

**Why:** PR is the review gate before merging to main.

- [ ] **Step 1: Generate full diff summary**

```bash
git diff main...HEAD --stat
```

Use this to write the PR description.

- [ ] **Step 2: Create PR via gh CLI**

```bash
gh pr create \
  --base main \
  --head codex/python-to-rust-runtime \
  --title "refactor: migrate Python runtime to native Rust/Tauri v0.5.0" \
  --body "## Summary

Migrate the entire Python FastAPI sidecar runtime to a native Rust/Tauri implementation.

### What changed
- **Removed** \`runtime/\` directory (29 Python files) + sidecar build scripts
- **Added** Rust backend in \`apps/desktop/src-tauri/src/\` (10 files, ~3k lines)
  - Audio capture: WASAPI loopback (Windows) + cpal (cross-platform)
  - ASR: Whisper API + Chat Completions dual-mode
  - Translation: LRU cache, glossary enforcement, context window
  - Pipeline: Tokio channel 3-stage async pipeline
  - Storage: SQLite via rusqlite with WAL mode
  - 13 Tauri commands replacing REST API + WebSocket
- **Migrated** frontend from HTTP/WebSocket to Tauri invoke/listen IPC
- **Updated** CI for Rust build/test, release workflow for multi-platform
- **Added** Chinese documentation translations
- Version bump: v0.4.13 → v0.5.0

### Why
- Eliminate 100MB+ Python runtime dependency
- Single-step build (no PyInstaller)
- Instant startup (no Python process launch delay)
- Zero network overhead (IPC vs localhost HTTP)

### Test plan
- [ ] \`cargo check\` passes
- [ ] \`npm run desktop:build\` passes (TypeScript + Vite)
- [ ] \`npm run lint\` passes
- [ ] \`npm run test\` passes
- [ ] Manual E2E: audio capture → ASR → translation flow
- [ ] CI passes on PR

### Breaking changes
- Old session data is NOT migrated (by design — see refactoring doc)
- Demo/mock mode removed
- Config format changed (now stored in SQLite instead of JSON file)"
```

- [ ] **Step 3: Verify PR was created**

```bash
gh pr view --web
```

Expected: PR opens in browser.

---

## Rollback Plan

If anything goes wrong before the PR is merged:

```bash
# Reset everything back to main
git checkout main
git branch -D codex/python-to-rust-runtime
# All working tree changes are lost — ensure you have backups or
# just re-apply from the stash if needed
```

If CI fails on the PR, fix the specific issues and push new commits to the same branch.
