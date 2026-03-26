# .NET Data Visualizer

A Visual Studio Code extension to inspect and visualize .NET data structures during a C# debug session.

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

### Method 1 — Variables panel (recommended)

1. Start a C# debug session and pause on a breakpoint.
2. In the **Variables** panel, right-click any variable.
3. Choose **"Visualize with .NET Visualizer"**.

### Method 2 — Command Palette

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
| `dotnetVisualizer.maxRows` | `1000` | Maximum DataTable rows fetched per table. Increase for larger datasets (slower). |
| `dotnetVisualizer.maxItems` | `10000` | Maximum List/Dictionary items fetched. |

> **Note:** fetching data from the debugger is sequential — large limits will make the visualizer slower to open.

---

## Known Limitations

- Only works while the debugger is **paused** (breakpoint / exception).
- Complex nested objects in a `DataTable` cell are shown as their `.ToString()` value.
- Dictionary extraction uses `System.Linq.Enumerable.ElementAt`, which requires .NET 3.5+.
- Very large collections (>2 000 items) are intentionally truncated for performance.

---

## Development

```bash
# Clone and install
git clone <repo-url>
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
