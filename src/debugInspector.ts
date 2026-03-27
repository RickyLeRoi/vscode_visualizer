import * as vscode from 'vscode';
import {
  VisualizerData,
  DataTableData,
  DataSetData,
  ListData,
  DictionaryData,
  UnknownData,
  ColumnInfo,
  ItemData,
  EntryData,
  PropertyData,
} from './types';

interface EvalResult {
  result: string;
  type?: string;
  variablesReference: number;
}

const SKIP = new Set([
  'Count', '[Count]', 'Length', '[Length]', 'Capacity',
  'Comparer', 'Keys', 'Values', 'SyncRoot',
  'IsReadOnly', 'IsSynchronized', 'IsFixedSize',
  '[Raw View]', 'Raw View', 'static members', 'Non-Public members'
]);

export class DebugInspector {
  private readonly session: vscode.DebugSession;
  private readonly frameId: number | undefined;
  private readonly maxRows: number;
  private readonly maxItems: number;
  private readonly offset: number;

  constructor(
    session: vscode.DebugSession,
    frameId?: number,
    overrides?: { maxRows?: number; maxItems?: number; offset?: number; pageNum?: number }
  ) {
    this.session = session;
    this.frameId = frameId;

    const cfg = vscode.workspace.getConfiguration('dotnetVisualizer');
    this.maxRows = overrides?.maxRows ?? cfg.get<number>('maxRows', 100);
    this.maxItems = overrides?.maxItems ?? cfg.get<number>('maxItems', 100);
    this.offset = overrides?.offset ?? 0;
  }

  // ─── Public entry point ─────────────────────────────────────────────────────

  async inspect(
    expression: string,
    onReady?: (skeleton: VisualizerData) => void | Promise<void>,
    onRowFetch?: (rowIndex: number, rowData: string[]) => void | Promise<void>
  ): Promise<VisualizerData> {
    // Use 'hover' context for type detection: it is a lightweight read-only eval
    // that does NOT invoke the full Roslyn compilation pipeline, avoiding CS0433
    // (IDictionaryDebugView<K,V> ambiguity between System.Collections and
    // System.Text.Json) that is triggered by 'repl' on any Dictionary type.
    const evalResult = await this.evaluate(expression, 'hover');
    const typeName = (evalResult.type ?? '').toLowerCase();
    const resultStr = evalResult.result ?? '';

    if (this.matchesDataSet(typeName, resultStr)) {
      return this.extractDataSet(expression, onReady, onRowFetch);
    }
    if (this.matchesDataTable(typeName, resultStr)) {
      return this.extractDataTable(expression, onReady, onRowFetch);
    }
    if (this.matchesDictionary(typeName, resultStr)) {
      return this.extractDictionary(expression, evalResult.type ?? 'Dictionary', evalResult.variablesReference);
    }
    if (this.matchesArray(typeName, resultStr)) {
      return this.extractList(expression, evalResult.type ?? 'Array', 'array', evalResult.variablesReference);
    }
    if (this.matchesList(typeName, resultStr)) {
      return this.extractList(expression, evalResult.type ?? 'List', 'list', evalResult.variablesReference);
    }

    // Generic fallback
    return this.extractUnknown(
      expression,
      evalResult.type ?? 'object',
      resultStr,
      evalResult.variablesReference
    );
  }

  // ─── Type detection ─────────────────────────────────────────────────────────

  private matchesDataSet(t: string, _r: string): boolean {
    // Exact match only — avoids false positives on IDictionary<string, DataSet> etc.
    return /^(system\.data\.)?dataset$/.test(t);
  }

  private matchesDataTable(t: string, _r: string): boolean {
    // Exact match only — avoids false positives on IDictionary<string, DataTable> etc.
    return /^(system\.data\.)?datatable$/.test(t);
  }

  private matchesDictionary(t: string, _r: string): boolean {
    return (
      t.includes('dictionary') ||
      t.includes('hashtable') ||
      t.includes('concurrentdictionary') ||
      t.includes('sorteddictionary') ||
      t.includes('idictionary')
    );
  }

  private matchesArray(t: string, _r: string): boolean {
    return t.endsWith('[]') || t.startsWith('system.array');
  }

  private matchesList(t: string, r: string): boolean {
    return (
      t.includes('list`1') ||
      t.includes('list<') ||
      t.includes('collection`1') ||
      t.includes('observablecollection') ||
      t.includes('ienumerable') ||
      t.includes('hashset') ||
      t.includes('sortedset') ||
      t.includes('queue') ||
      t.includes('stack') ||
      r.toLowerCase().includes('count =')
    );
  }

  /** Returns true only for types that support the [] indexer (T[], List<T>, IList<T>). */
  private isIndexableByTypeName(t: string): boolean {
    const lower = t.toLowerCase();
    return (
      lower.endsWith('[]') ||
      lower.startsWith('system.array') ||
      lower.includes('list`1') ||
      lower.includes('list<') ||
      lower.includes('ilist`1') ||
      lower.includes('ilist<')
    );
  }

  // ─── DataTable extractor ────────────────────────────────────────────────────

  async extractDataTable(expr: string, onReady?: (skeleton: VisualizerData) => void | Promise<void>, onRowFetch?: (rowIndex: number, rowData: string[]) => void | Promise<void>): Promise<DataTableData> {
    // Try fast JSON serialization first
    const jsonData = await this.extractDataTableViaJSON(expr, onReady, onRowFetch);
    if (jsonData) return jsonData;

    // Fallback to slow cell-by-cell extraction
    return this.extractDataTableSlow(expr, onReady, onRowFetch);
  }

  private async extractDataTableViaJSON(expr: string, onReady?: (skeleton: VisualizerData) => void | Promise<void>, onRowFetch?: (rowIndex: number, rowData: string[]) => void | Promise<void>): Promise<DataTableData | null> {
    try {
      const tableName = await this.safeEvalString(`${expr}.TableName`);
      const totalRows = await this.safeEvalInt(`${expr}.Rows.Count`);
      const fetchCount = Math.min(totalRows, this.maxRows);
      const colCount = await this.safeEvalInt(`${expr}.Columns.Count`);

      // Get column info
      const columns: ColumnInfo[] = [];
      for (let i = 0; i < colCount; i++) {
        const name = await this.safeEvalString(`${expr}.Columns[${i}].ColumnName`, `Col${i}`);
        const typeName = await this.safeEvalString(`${expr}.Columns[${i}].DataType.Name`, 'object');
        columns.push({ name, typeName });
      }

      // Send skeleton immediately
      if (onReady) {
        const skeleton: DataTableData = {
          kind: 'datatable',
          tableName: tableName || 'DataTable',
          columns,
          rows: [],
          totalRows,
          truncated: totalRows > this.maxRows,
        };
        await onReady(skeleton);
      }

      // Request rows as JSON array: [["val1", "val2"], ["val3", "val4"], ...]
      // With pagination support using offset
      const jsonRowsExpr = `
        string.Join("\\n", 
          Enumerable.Range(${this.offset}, Math.Min(${fetchCount}, Math.Max(0, ${expr}.Rows.Count - ${this.offset})))
            .Select(r => 
              "[" + string.Join(",", 
                Enumerable.Range(0, ${expr}.Columns.Count)
                  .Select(c => 
                    "\\\"" + (${expr}.Rows[r][c]?.ToString() ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\\"", "\\\\\\\"").Replace("\\n", "\\\\n").Replace("\\r", "\\\\r") + "\\\""
                  )
              ) + "]"
            )
        )
      `;

      const now = new Date();
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timeStr = now.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.error(`[${timeStr}.${ms}] Requesting all ${fetchCount} rows as JSON from DAP...`);

      const jsonRowsStr = await this.safeEvalString(jsonRowsExpr, '');
      if (!jsonRowsStr) {
        console.error(`[${timeStr}.${ms}] JSON rows expr returned empty`);
        return null;
      }

      const now2 = new Date();
      const ms2 = String(now2.getMilliseconds()).padStart(3, '0');
      const timeStr2 = now2.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.error(`[${timeStr2}.${ms2}] Received JSON rows (${jsonRowsStr.length} chars), parsing...`);

      // Debug: check what separators we actually have
      const hasRealNewlines = jsonRowsStr.includes('\n');
      const hasEscapedNewlines = jsonRowsStr.includes('\\n');
      console.error(`[${timeStr2}.${ms2}] Has real newlines: ${hasRealNewlines}, Has escaped newlines (backslash-n): ${hasEscapedNewlines}`);
      if (hasEscapedNewlines && !hasRealNewlines) {
        console.error(`[${timeStr2}.${ms2}] WARNING: Rows appear to be separated by escaped newlines (\\n), not real newlines!`);
      }

      // Parse JSON lines and notify for each row
      const rows: string[][] = [];
      // Try to split by real newlines first, then by escaped newlines if needed
      let lines = jsonRowsStr.split('\n').filter((l: string) => l.trim());
      if (lines.length <= 1) {
        // If split by \n didn't work, try splitting by escaped newlines
        lines = jsonRowsStr.split('\\n').filter((l: string) => l.trim());
        console.error(`[${timeStr2}.${ms2}] Retried split with escaped newlines, got ${lines.length} rows`);
      } else {
        console.error(`[${timeStr2}.${ms2}] Split by real newlines, got ${lines.length} rows`);
      }
      for (let i = 0; i < lines.length; i++) {
        try {
          const row = JSON.parse(lines[i]) as string[];
          rows.push(row);
          if (onRowFetch) {
            await onRowFetch(i, row);
          }
        } catch (e) {
          console.error(`[${timeStr2}.${ms2}] Failed to parse row ${i}: ${lines[i]}`);
          rows.push(new Array(colCount).fill('(error)'));
        }
      }

      const now3 = new Date();
      const ms3 = String(now3.getMilliseconds()).padStart(3, '0');
      const timeStr3 = now3.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.error(`[${timeStr3}.${ms3}] Parsed ${rows.length} rows successfully`);

      return {
        kind: 'datatable',
        tableName: tableName || 'DataTable',
        columns,
        rows,
        totalRows,
        truncated: totalRows > this.maxRows,
        pageSize: this.maxRows,
        offset: this.offset,
      };
    } catch (err) {
      console.error(`[extractDataTableViaJSON] Error: ${err}`);
      return null;
    }
  }

  private async extractDataTableSlow(expr: string, onReady?: (skeleton: VisualizerData) => void | Promise<void>, onRowFetch?: (rowIndex: number, rowData: string[]) => void | Promise<void>): Promise<DataTableData> {
    const tableName = await this.safeEvalString(`${expr}.TableName`);
    const colCount = await this.safeEvalInt(`${expr}.Columns.Count`);

    const columns: ColumnInfo[] = [];
    for (let i = 0; i < colCount; i++) {
      const name = await this.safeEvalString(`${expr}.Columns[${i}].ColumnName`, `Col${i}`);
      const typeName = await this.safeEvalString(`${expr}.Columns[${i}].DataType.Name`, 'object');
      columns.push({ name, typeName });
    }

    const totalRows = await this.safeEvalInt(`${expr}.Rows.Count`);
    const fetchCount = Math.min(totalRows, this.maxRows);
    const truncated = totalRows > this.maxRows;

    // Send skeleton immediately so webview can show structure before fetching data
    if (onReady) {
      const skeleton: DataTableData = {
        kind: 'datatable',
        tableName: tableName || 'DataTable',
        columns,
        rows: [], // empty for now
        totalRows,
        truncated,
      };
      await onReady(skeleton);
    }

    const rows: string[][] = [];
    // Evaluate all cells in parallel per row instead of sequentially
    for (let r = 0; r < fetchCount; r++) {
      const cellPromises = [];
      for (let c = 0; c < colCount; c++) {
        cellPromises.push(
          this.safeEvalString(
            // `${expr}.Rows[${r}][${c}] == null ? "(null)" : ${expr}.Rows[${r}][${c}].ToString()`,
            `${expr}.Rows[${r}][${c}]`,
            '(error)'
          )
        );
      }
      const row = await Promise.all(cellPromises);
      rows.push(row);
      // Log row completion with timestamp
      const now = new Date();
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timeStr = now.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.error(`[${timeStr}.${ms}] Row ${r} fetched (${colCount} cells)`);
      // Notify immediately after fetching this row
      if (onRowFetch) {
        await onRowFetch(r, row);
      }
    }

    return {
      kind: 'datatable',
      tableName: tableName || 'DataTable',
      columns,
      rows,
      totalRows,
      truncated,
    };
  }

  // ─── DataSet extractor ──────────────────────────────────────────────────────

  async extractDataSet(expr: string, onReady?: (skeleton: VisualizerData) => void | Promise<void>, onRowFetch?: (rowIndex: number, rowData: string[]) => void | Promise<void>): Promise<DataSetData> {
    const dataSetName = await this.safeEvalString(`${expr}.DataSetName`);
    const tableCount = await this.safeEvalInt(`${expr}.Tables.Count`);

    const tables: DataTableData[] = [];
    for (let i = 0; i < tableCount; i++) {
      try {
        const tbl = await this.extractDataTable(`${expr}.Tables[${i}]`, onReady, onRowFetch);
        tables.push(tbl);
      } catch {
        // skip failed table
      }
    }

    return {
      kind: 'dataset',
      dataSetName: dataSetName || 'DataSet',
      tables,
    };
  }

  // ─── List / Array extractor ─────────────────────────────────────────────────
  //
  // Uses a hybrid approach:
  //   1. Try [] indexing (fast, works for T[], List<T>, IList<T>)
  //   2. If [] fails (HashSet, Queue, Stack, etc.) fall back to the DAP
  //      `variables` protocol — same strategy used for dictionaries.

  async extractList(
    expr: string,
    typeName: string,
    kind: 'list' | 'array',
    variablesRef = 0
  ): Promise<ListData> {
    // Determine count
    let totalCount = await this.safeEvalInt(`${expr}.Length`);
    if (totalCount === 0) {
      totalCount = await this.safeEvalInt(`${expr}.Count`);
    }

    const fetchCount = Math.min(totalCount, this.maxItems);
    const truncated = totalCount > this.maxItems;
    const items: ItemData[] = [];

    // ── Decide strategy from type name (avoids triggering CS0021 on HashSet etc.) ─
    // Only T[] and List<T>/IList<T> support the [] indexer.
    // HashSet, SortedSet, Queue, Stack, IEnumerable → must use DAP variables.
    const useIndexer = this.isIndexableByTypeName(typeName);

    if (useIndexer) {
      // ── Indexer path (T[], List<T>) ────────────────────────────────────────
      if (fetchCount > 0) {
        for (let i = 0; i < fetchCount; i++) {
          const value = await this.safeEvalString(
            `${expr}[${i}] == null ? "(null)" : ${expr}[${i}].ToString()`,
            '(error)'
          );
          items.push({ index: i, value });
        }
      }
    } else {
      // ── DAP variables path (HashSet, Queue, Stack, SortedSet, …) ──────────
      // Always attempt this path regardless of fetchCount — safeEvalInt may
      // have returned 0 for Count even though the collection is non-empty.
      // 'hover' context may return variablesReference=0; fall back to 'repl'
      // which is safe here (CS0433 only affects Dictionary, not Set/Queue/Stack).
      if (variablesRef === 0) {
        try {
          const repl = await this.evaluate(expr, 'repl');
          variablesRef = repl.variablesReference;
        } catch { /* ignore */ }
      }
      if (variablesRef > 0) {
        try {
          const resp = await this.session.customRequest('variables', { variablesReference: variablesRef });
          const vars: any[] = resp.variables ?? [];

          for (const v of vars) {
            const name: string = String(v.name ?? '');
            if (SKIP.has(name)) { continue; }

            const idx = items.length;
            // Name is usually [0], [1], … — strip brackets if present
            const displayIdx = /^\[\d+\]$/.test(name) ? parseInt(name.slice(1, -1), 10) : idx;
            items.push({ index: displayIdx, value: String(v.value ?? '') });
            if (items.length >= this.maxItems) { break; }
          }
        } catch {
          // leave items empty
        }
      }

      if (totalCount === 0) { totalCount = items.length; }
    }

    return {
      kind,
      typeName,
      items,
      totalCount,
      truncated,
    };
  }

  // ─── Dictionary extractor ───────────────────────────────────────────────────
  //
  // Uses the DAP `variables` protocol instead of C# LINQ expressions.
  // Evaluating LINQ on Dictionary.Keys/Values triggers CS0433 because both
  // System.Collections and System.Text.Json define IDictionaryDebugView<K,V>
  // via DebuggerTypeProxyAttribute, causing an ambiguity in the expression
  // evaluator's compiler context.

  async extractDictionary(
    expr: string,
    typeName: string,
    variablesRef: number
  ): Promise<DictionaryData> {
    // .Count is a simple property access that doesn't involve DebuggerTypeProxy
    // and is safe to evaluate. Fall back to 0 on error.
    let totalCount = await this.safeEvalInt(`${expr}.Count`);
    const entries: EntryData[] = [];

    if (variablesRef > 0) {
      try {
        const topResp = await this.session.customRequest('variables', { variablesReference: variablesRef });
        const topVars: any[] = topResp.variables ?? [];

        // If .Count eval failed, try to read it from the variables list
        if (totalCount === 0) {
          const countVar = topVars.find((v: any) => ['[Count]', 'Count'].includes(v.name));
          if (countVar) {
            totalCount = parseInt(String(countVar.value ?? '0'), 10) || 0;
          }
        }

        for (const v of topVars) {
          const name: string = String(v.name ?? '');
          if (SKIP.has(name)) { continue; }

          // Case C: ["key"] [DebugViewDictionaryItem]  (coreclr DebugView proxy format)
          // Must be checked BEFORE Case B because the name starts with [ and ends with ]
          if (name.includes('] [DebugViewDictionaryItem')) {
            let rawKey = name.slice(0, name.indexOf('] [DebugViewDictionaryItem'));
            if (rawKey.startsWith('[')) { rawKey = rawKey.slice(1); }
            if ((rawKey.startsWith('"') && rawKey.endsWith('"')) ||
                (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
              rawKey = rawKey.slice(1, -1);
            }
            entries.push({
              key: rawKey || name,
              value: String(v.value ?? ''),
            });
          }
          // Case A: [n] = KeyValuePair — must expand children to get Key/Value
          else if (/^\[\d+\]$/.test(name) && (v.variablesReference ?? 0) > 0) {
            try {
              const kvResp = await this.session.customRequest('variables', { variablesReference: v.variablesReference });
              const kvVars: any[] = kvResp.variables ?? [];
              const keyVar = kvVars.find((kv: any) => kv.name === 'Key' || kv.name === 'key');
              const valVar = kvVars.find((kv: any) => kv.name === 'Value' || kv.name === 'value');
              entries.push({
                key: keyVar ? String(keyVar.value ?? name) : name,
                value: valVar ? String(valVar.value ?? '') : String(v.value ?? ''),
              });
            } catch {
              // Drill-in failed — use the raw display value
              entries.push({ key: name, value: String(v.value ?? '') });
            }
          }
          // Case B: [someKey] directly as name (some debugger versions / Hashtable)
          else if (name.startsWith('[') && name.endsWith(']')) {
            entries.push({
              key: name.slice(1, -1),
              value: String(v.value ?? ''),
            });
          }

          if (entries.length >= this.maxItems) { break; }
        }
      } catch {
        // variables request failed — entries will be empty
      }
    }

    if (totalCount === 0) { totalCount = entries.length; }

    return {
      kind: 'dictionary',
      typeName,
      entries,
      totalCount,
      truncated: totalCount > entries.length,
    };
  }

  // ─── Generic object extractor ───────────────────────────────────────────────

  async extractUnknown(
    expr: string,
    typeName: string,
    displayValue: string,
    variablesReference: number
  ): Promise<UnknownData> {
    const properties: PropertyData[] = [];

    if (variablesReference > 0) {
      try {
        const resp = await this.session.customRequest('variables', { variablesReference });
        const vars: any[] = (resp.variables ?? []).slice(0, 100);
        for (const v of vars) {
          const name = String(v.name ?? '');
          // Skip pseudo-properties like "Raw View"
          if (SKIP.has(name)) { continue; }

          // Strip type annotation from name — debugger formats ValueTuple fields as "FieldName [type]"
          // Extract just the field name before the " [" delimiter
          const cleanName = name.includes(' [') ? name.slice(0, name.indexOf(' [')) : name;

          properties.push({
            name: cleanName,
            value: String(v.value ?? ''),
            typeName: v.type ? String(v.type) : undefined,
          });
        }
      } catch {
        // ignore
      }
    }

    return {
      kind: 'unknown',
      typeName: typeName || 'object',
      expression: expr,
      displayValue,
      properties,
    };
  }

  // ─── DAP helpers ────────────────────────────────────────────────────────────

  private async evaluate(expression: string, context: 'repl' | 'hover' | 'variables' = 'repl'): Promise<EvalResult> {
    const args: Record<string, unknown> = { expression, context };
    if (this.frameId !== undefined) {
      args.frameId = this.frameId;
    }
    return this.session.customRequest('evaluate', args) as Promise<EvalResult>;
  }

  private async safeEvalString(expression: string, fallback = ''): Promise<string> {
    try {
      const r = await this.evaluate(expression);
      return this.unquote(r.result ?? fallback);
    } catch {
      return fallback;
    }
  }

  private async safeEvalInt(expression: string): Promise<number> {
    try {
      const r = await this.evaluate(expression);
      const n = parseInt(String(r.result ?? '0').trim(), 10);
      return isNaN(n) ? 0 : n;
    } catch {
      return 0;
    }
  }

  /** Strip surrounding quotes that the C# evaluator adds to strings. */
  private unquote(s: string): string {
    s = s.trim();
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return s;
  }
}
