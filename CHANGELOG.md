# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- ESLint + Prettier for TypeScript code quality
- Ruff for Python linting and formatting
- Vitest frontend testing framework with 43 unit tests
- pytest-cov for Python test coverage (67.64%)
- CI workflow for pull requests and pushes to main
- Pre-commit hooks via husky + lint-staged
- .editorconfig for consistent editor settings
- React Error Boundary for graceful failure handling
- CSP configuration for Tauri security
- Python dependency locking via pip-compile
- CONTRIBUTING.md with development guidelines
- GitHub issue and PR templates
- MIT License

### Changed
- Release workflow now includes lint and test steps before build
- Python tests moved to use pytest as test runner

### Fixed
- Removed stale artifact file (`=0.20.0`) from root
- Moved `test_audio_capture.py` to proper test directory
- Fixed unused variable warnings in SubtitlePanel and useSubtitleSocket

## [0.1.0] - 2026-01-01

### Added
- Initial demo release
- Tauri v2 desktop application shell
- Python FastAPI runtime with audio capture
- Real-time ASR via OpenAI-compatible API
- LLM-powered translation with glossary support
- Floating subtitle overlay window
- Session history and glossary management
- Mock pipeline for demonstration
- PyInstaller sidecar packaging
- Windows NSIS and MSI installers
