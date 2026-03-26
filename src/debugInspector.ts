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

export class DebugInspector {
  private readonly session: vscode.DebugSession;
  private readonly frameId: number | undefined;
  private readonly maxRows: number;
  private readonly maxItems: number;

  constructor(session: vscode.DebugSession, frameId?: number) {
    this.session = session;
    this.frameId = frameId;

    const cfg = vscode.workspace.getConfiguration('dotnetVisualizer');
    this.maxRows = cfg.get<number>('maxRows', 50);
    this.maxItems = cfg.get<number>('maxItems', 200);
  }

  // ─── Public entry point ─────────────────────────────────────────────────────

  async inspect(expression: string): Promise<VisualizerData> {
    // Use 'hover' context for type detection: it is a lightweight read-only eval
    // that does NOT invoke the full Roslyn compilation pipeline, avoiding CS0433
    // (IDictionaryDebugView<K,V> ambiguity between System.Collections and
    // System.Text.Json) that is triggered by 'repl' on any Dictionary type.
    const evalResult = await this.evaluate(expression, 'hover');
    const typeName = (evalResult.type ?? '').toLowerCase();
    const resultStr = evalResult.result ?? '';

    if (this.matchesDataSet(typeName, resultStr)) {
      return this.extractDataSet(expression);
    }
    if (this.matchesDataTable(typeName, resultStr)) {
      return this.extractDataTable(expression);
    }
    if (this.matchesDictionary(typeName, resultStr)) {
      return this.extractDictionary(expression, evalResult.type ?? 'Dictionary', evalResult.variablesReference);
    }
    if (this.matchesArray(typeName, resultStr)) {
      return this.extractList(expression, evalResult.type ?? 'Array', 'array');
    }
    if (this.matchesList(typeName, resultStr)) {
      return this.extractList(expression, evalResult.type ?? 'List', 'list');
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

  // ─── DataTable extractor ────────────────────────────────────────────────────

  async extractDataTable(expr: string): Promise<DataTableData> {
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

    const rows: string[][] = [];
    for (let r = 0; r < fetchCount; r++) {
      const row: string[] = [];
      for (let c = 0; c < colCount; c++) {
        const cell = await this.safeEvalString(
          `${expr}.Rows[${r}][${c}] == null ? "(null)" : ${expr}.Rows[${r}][${c}].ToString()`,
          '(error)'
        );
        row.push(cell);
      }
      rows.push(row);
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

  async extractDataSet(expr: string): Promise<DataSetData> {
    const dataSetName = await this.safeEvalString(`${expr}.DataSetName`);
    const tableCount = await this.safeEvalInt(`${expr}.Tables.Count`);

    const tables: DataTableData[] = [];
    for (let i = 0; i < tableCount; i++) {
      try {
        const tbl = await this.extractDataTable(`${expr}.Tables[${i}]`);
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

  async extractList(
    expr: string,
    typeName: string,
    kind: 'list' | 'array'
  ): Promise<ListData> {
    // Arrays use .Length, Lists use .Count
    let totalCount = await this.safeEvalInt(`${expr}.Length`);
    if (totalCount === 0) {
      totalCount = await this.safeEvalInt(`${expr}.Count`);
    }

    const fetchCount = Math.min(totalCount, this.maxItems);
    const truncated = totalCount > this.maxItems;

    const items: ItemData[] = [];
    for (let i = 0; i < fetchCount; i++) {
      const value = await this.safeEvalString(
        `${expr}[${i}] == null ? "(null)" : ${expr}[${i}].ToString()`,
        '(error)'
      );
      items.push({ index: i, value });
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
          const countVar = topVars.find((v: any) => v.name === 'Count');
          if (countVar) {
            totalCount = parseInt(String(countVar.value ?? '0'), 10) || 0;
          }
        }

        // Names to skip — debugger pseudo-properties and non-entry fields
        const SKIP = new Set([
          'Count', 'Comparer', 'Keys', 'Values', 'SyncRoot',
          'IsReadOnly', 'IsSynchronized', 'IsFixedSize',
          '[Raw View]', 'static members',
        ]);

        for (const v of topVars) {
          const name: string = String(v.name ?? '');
          if (SKIP.has(name) || name.startsWith('[Raw')) { continue; }

          // Case A: [n] = KeyValuePair — must expand children to get Key/Value
          if (/^\[\d+\]$/.test(name) && (v.variablesReference ?? 0) > 0) {
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
          properties.push({
            name: String(v.name ?? ''),
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
