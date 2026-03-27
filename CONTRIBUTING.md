# Contributing to .NET Data Visualizer for VS Code

Thank you for your interest in contributing! Please read the following guidelines before opening an issue or pull request.

---

## Branch Policy

| Branch | Access | Purpose |
|--------|--------|---------|
| `main` | **Owner only** | Production-ready code. Direct pushes are reserved exclusively for the repository owner. |

There are **no** planned `dev`, `beta`, or release staging branches. All changes land in `main` once reviewed and approved.

---

## How to Contribute

### Reporting Bugs

Open a [GitHub Issue](https://github.com/RickyLeRoi/vscode_visualizer/issues) with:

- A clear, descriptive title.
- Steps to reproduce the problem.
- Expected vs. actual behavior.
- VS Code version, OS, and C# extension version.

### Suggesting Features

Open a [GitHub Issue](https://github.com/RickyLeRoi/vscode_visualizer/issues) labeled `enhancement` with a description of the use case and proposed behavior.

### Submitting a Pull Request

1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b fix/your-fix-name
   ```
2. Make your changes and ensure the project compiles:
   ```bash
   npm install
   npm run compile
   ```
3. Keep commits focused and atomic. Write clear commit messages.
4. Open a **Pull Request targeting `main`**.

> **Note:** All pull requests must target the `main` branch. Only the repository owner (@RickyLeRoi) can review and approve pull requests. Do not expect community reviews or approvals from other contributors.

---

## Review Process

- Pull requests are reviewed exclusively by the repository owner.
- There is no guaranteed SLA for reviews.
- PRs that do not compile, break existing behavior, or fall outside the project scope will be closed without merge.

---

## Development Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/vscode_visualizer.git
cd vscode_visualizer

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (recompiles on save)
npm run watch
```

Press **F5** in VS Code to launch an *Extension Development Host* with the extension loaded.

---

## Code Style

- TypeScript for all extension source code (`src/`).
- Plain JavaScript (ES2020) for webview scripts (`media/`).
- No external runtime dependencies — keep the bundle lean.
- Run `npm run lint` before submitting.

---

## License

By submitting a pull request you agree that your contribution will be licensed under the same license as this project.
