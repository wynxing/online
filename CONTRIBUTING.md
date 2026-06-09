# Contributing to AI Interpretation Assistant

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 22+
- Python 3.10+
- Rust (stable)
- npm

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/ai-simultaneous-interpretation-assistant.git
   cd ai-simultaneous-interpretation-assistant
   ```

2. Install frontend dependencies:
   ```bash
   npm install
   ```

3. Install Python dependencies:
   ```bash
   cd runtime
   pip install -r requirements.txt
   pip install -r requirements-dev.txt
   ```

4. Start development:
   ```bash
   # Terminal 1: Python runtime
   npm run runtime

   # Terminal 2: Desktop app
   npm run tauri:dev
   ```

## Code Quality

### Linting

- **TypeScript**: `npm run lint` (ESLint)
- **Python**: `cd runtime && ruff check app/ tests/`

### Formatting

- **TypeScript**: `npm run format` (Prettier)
- **Python**: `cd runtime && ruff format app/ tests/`

### Pre-commit Hooks

Pre-commit hooks run automatically on `git commit`. They will:
- Lint and format staged TypeScript files
- Lint and format staged Python files

To run manually: `npx lint-staged`

## Testing

### Frontend Tests

```bash
npm run test              # Run once
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage
```

### Python Tests

```bash
npm run test:runtime      # Run all tests
cd runtime && python -m pytest tests/ -v --cov=app  # With coverage
```

### Test Coverage

- Frontend: Aim for 80%+ coverage on new code
- Python: Coverage threshold is 60%

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
fix: handle WebSocket reconnection on network loss
refactor: extract audio processing into separate module
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with tests
3. Ensure all checks pass:
   ```bash
   npm run lint
   npm run test
   cd runtime && python -m pytest tests/
   ```
4. Submit a pull request with a clear description

## Project Structure

```
├── apps/desktop/          # Tauri + React frontend
│   ├── src/              # Source code
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── utils/        # Utility functions
│   │   └── test/         # Frontend tests
│   └── src-tauri/        # Rust Tauri code
├── runtime/              # Python FastAPI backend
│   ├── app/             # Application code
│   │   └── pipeline/    # ASR + Translation pipeline
│   └── tests/           # Python tests
└── scripts/             # Build and dev scripts
```

## Questions?

Feel free to open an issue for any questions or discussions.
