# Repository Guidelines

## Project Structure & Module Organization
This repository is currently minimal and does not yet include application code, tests, or build tooling. Until a concrete stack is added, keep contributions organized with a predictable layout:

- `src/` for production code
- `tests/` for automated tests
- `assets/` for static files such as images or fixtures
- `docs/` for design notes or operational guides

Keep modules small and grouped by feature. For example, place Telegram client code in `src/telegram/` and matching tests in `tests/telegram/`.

## Build, Test, and Development Commands
No project-specific commands are defined yet. When adding tooling, expose a minimal, documented set of commands such as:

- `npm install` or equivalent to install dependencies
- `npm test` to run the full test suite
- `npm run lint` to enforce style rules
- `npm run dev` to start local development

If you introduce a different stack, update this file in the same change so contributors have one reliable entry point.

## Coding Style & Naming Conventions
Use 4 spaces for indentation in Markdown, YAML, and Python-style formats; follow the formatter defaults for any language-specific toolchain you add. Prefer descriptive, lowercase directory names (`src/bot/`), `snake_case` for Python files, and `kebab-case` or framework-standard naming for frontend assets.

Add formatting and linting early and run them before opening a PR. Keep files ASCII unless the file already requires Unicode.

## Testing Guidelines
Place tests under `tests/` and mirror the source layout. Name test files after the unit under test, such as `tests/telegram/test_dispatcher.py` or `dispatcher.test.ts`. Cover new behavior and important edge cases; avoid merging untested logic.

Document the exact test command in the project README and here once the framework is chosen.

## Commit & Pull Request Guidelines
There is no Git history in the current workspace, so no established commit pattern can be inferred. Use short, imperative commit messages and prefer Conventional Commit prefixes where helpful, such as `feat: add webhook handler` or `fix: guard empty update payload`.

Pull requests should include a clear summary, testing notes, and linked issue references when applicable. Include screenshots or sample bot interactions for user-facing changes.

## Configuration & Secrets
Do not commit API tokens, session files, or `.env` values. Keep local configuration in ignored files and document required environment variables in `README.md`.
