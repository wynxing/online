# Contributing to AI Interpretation Assistant

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 22+
- npm 10+
- Rust (stable)

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/ai-simultaneous-interpretation-assistant.git
   cd ai-simultaneous-interpretation-assistant
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development:
   ```bash
   npm run tauri:dev
   ```

## Code Quality

### Linting & Formatting

- **TypeScript**: `npm run lint` (ESLint) / `npm run format` (Prettier)
- **Rust**: `cargo clippy` / `cargo fmt`

### Pre-commit Hooks

Pre-commit hooks run automatically on `git commit`. They lint and format staged TypeScript files.

To run manually: `npx lint-staged`

## Testing

### Frontend Tests

```bash
npm run test              # Run once
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage
```

### Rust Tests

```bash
cd apps/desktop/src-tauri
cargo test
```

### Test Coverage

- Frontend: Aim for 80%+ coverage on new code

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `docs`: Documentation
- `test`: Adding tests
- `chore`: Maintenance
- `perf`: Performance improvement

Examples:
```
feat: add real-time subtitle export
fix: handle audio capture device switching
refactor: extract pipeline into separate module
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with tests
3. Ensure all checks pass:
   ```bash
   npm run lint
   npm run test
   cd apps/desktop/src-tauri && cargo test
   ```
4. Submit a pull request with a clear description

## Project Structure

```
├── apps/desktop/          # Tauri + React frontend
│   ├── src/              # Source code
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom React hooks
│   │   └── test/         # Frontend tests
│   └── src-tauri/        # Rust Tauri code
│       └── src/
│           ├── commands/ # Tauri invoke handlers
│           ├── api/      # ASR and translation clients
│           ├── audio/    # Device listing and capture
│           ├── pipeline/ # Capture -> ASR -> translation
│           └── storage/  # SQLite persistence
└── scripts/              # Build and dev scripts
```

## Questions?

Feel free to open an issue for any questions or discussions.
