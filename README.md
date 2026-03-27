# .NET Data Visualizer for VS Code

Visualize DataSet, DataTable, List, Dictionary and other .NET collections during C# debugging in VS Code.

Supported types:

| Type | Visualizzazione |
|------|----------------|
| `DataTable` | Griglia con colonne ordinabili e tipo nel tooltip |
| `DataSet` | Tab per ogni `DataTable` contenuta |
| `List<T>` / `T[]` / `IEnumerable<T>` | Tabella indice → valore |
| `Dictionary<K,V>` / `Hashtable` / `SortedDictionary` | Tabella chiave → valore |
| Qualunque oggetto | Property browser (via DAP `variables`) |

All views support **real-time text filtering**, **column sorting**, **CSV export** and **clipboard copy**.

---

## Requirements

- Visual Studio Code **≥ 1.85**
- [C# Dev Kit](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csdevkit) or [C# extension](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) with a `coreclr` or `clr` debug session

---

## Usage

There are four ways to open the visualizer:

### Method 1 — Editor selection + right-click (recommended)

1. Start a C# debug session and pause on a breakpoint.
2. In the editor, **select** a variable name or C# expression.
3. Right-click → **"Visualize with .NET Visualizer"**.

### Method 2 — Keyboard shortcut

1. Start a C# debug session and pause on a breakpoint.
2. In the editor, select a variable name or place the cursor on it.
3. Press **`Ctrl+Alt+V`** (Mac: `Cmd+Alt+V`).

> If nothing is selected, the word under the cursor is used automatically.

### Method 3 — Variables panel

1. Start a C# debug session and pause on a breakpoint.
2. In the **Variables** panel, right-click any variable.
3. Choose **"Visualize with .NET Visualizer"**.

### Method 4 — Command Palette

1. Start a C# debug session and pause on a breakpoint.
2. Open the Command Palette (`Ctrl+Shift+P`).
3. Run **`.NET Visualizer: Visualize Expression`**.
4. Type a variable name or any valid C# expression (e.g. `ds.Tables[0]`).

---

## Features

### DataTable / DataSet

- All columns are displayed with their .NET type in the header tooltip.
- Click any column header to sort ascending/descending.
- DataSet tables are shown as tabs — click a tab to switch table.

### List / Array

- Each element is shown with its zero-based index.
- Works with `List<T>`, `T[]`, `ObservableCollection<T>`, `HashSet<T>`, `Queue<T>`, `Stack<T>`, etc.

### Dictionary

- Keys and values are shown side by side.
- Works with `Dictionary<K,V>`, `SortedDictionary<K,V>`, `ConcurrentDictionary<K,V>`, `Hashtable`.

### Filter

Type in the search box to filter rows in real time — works across all columns/values.

### Export

- **Export CSV** — downloads the current view as a `.csv` file.
- **Copy** — copies the CSV text to the clipboard.

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dotnetVisualizer.maxRows` | `500` | Maximum DataTable rows fetched per table. Increase for larger datasets (slower). |
| `dotnetVisualizer.maxItems` | `2000` | Maximum List/Dictionary items fetched. |

> **Note:** fetching data from the debugger is sequential — large limits will make the visualizer slower to open.

---

## Known Limitations

- Only works while the debugger is **paused** (breakpoint / exception).
- Complex nested objects in a `DataTable` cell are shown as their `.ToString()` value.
- Very large collections are intentionally truncated for performance (configurable via settings).

---

## CI / CD (GitHub Actions)

Two workflows are included in `.github/workflows/`:

### `ci.yml` — runs on every push and pull request

- Installs dependencies (`npm ci`)
- Compiles TypeScript (`npm run compile`)
- Uploads the `out/` folder as a build artifact

### `release.yml` — runs when a tag matching `v*.*.*` is pushed

- Compiles and packages the `.vsix`
- Creates a **GitHub Release** with the `.vsix` attached and auto-generated release notes
- Publishes to the **Visual Studio Marketplace** (requires secret `VSCE_PAT`)
- Publishes to the **Open VSX Registry** (requires secret `OVSX_PAT`)

The publish steps are conditional — if the corresponding secret is not set, the step is skipped automatically.

#### How to trigger a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

#### Required GitHub secrets

| Secret | Description |
|--------|-------------|
| `VSCE_PAT` | Azure DevOps PAT with scope `Marketplace → publish` |
| `OVSX_PAT` | Token from [open-vsx.org](https://open-vsx.org) |

Add them under **Settings → Secrets and variables → Actions** in the GitHub repository.

---

## Distribution

### Package as `.vsix` (manual install)

```bash
npx vsce package
```

Generates `vscode-dotnet-data-visualizer-1.0.0.vsix`. Install it with:

```bash
code --install-extension vscode-dotnet-data-visualizer-1.0.0.vsix
```

Or from VS Code: **Extensions** → `···` → **Install from VSIX…**

### Publish to Visual Studio Marketplace

1. Create a publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Generate a Personal Access Token (PAT) on Azure DevOps with scope `Marketplace (publish)`
3. Login and publish:

```bash
npx vsce login <publisher-id>
npx vsce publish
```

Or in a single command:

```bash
npx vsce publish --pat <YOUR_PAT>
```

### Publish to Open VSX Registry (VS Codium / other forks)

```bash
npx ovsx publish vscode-dotnet-data-visualizer-1.0.0.vsix --pat <OPENVSX_TOKEN>
```

---

## Development

```bash
# Clone and install
git clone https://github.com/RickyLeRoi/vscode_visualizer.git
cd vscode_visualizer
npm install

# Compile
npm run compile

# Watch mode (recompiles on save)
npm run watch
```

Press **F5** in VS Code to open an *Extension Development Host* window with the extension loaded.

---

## License

[MIT](LICENSE.md)
