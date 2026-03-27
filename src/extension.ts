import * as vscode from 'vscode';
import { DebugInspector } from './debugInspector';
import { VisualizerView } from './visualizerView';

// ── Cache system for pagination ────────────────────────────────────────────────
// Cache structure: Map<expression, { pageSize, totalCount, pages: Map<pageNum, rowArray> }>
interface CachedPage {
  pagnum: number;
  rows: string[][];
}

interface CacheEntry {
  pageSize: number;
  totalCount: number;
  pages: Map<number, string[][]>;
  metadata: any;
}

const dataCache = new Map<string, CacheEntry>();

function getCacheKey(expression: string, options?: { maxRows?: number; maxItems?: number }): string {
  // Include maxRows/maxItems in cache key so different configs don't conflict
  const max = options?.maxRows || options?.maxItems || 50;
  return `${expression}@${max}`;
}

function getCachedPage(expression: string, pageNum: number, options?: { maxRows?: number; maxItems?: number }): string[][] | undefined {
  const key = getCacheKey(expression, options);
  return dataCache.get(key)?.pages.get(pageNum);
}

function cachePageData(expression: string, pageNum: number, rows: string[][], metadata: any, options?: { maxRows?: number; maxItems?: number }): void {
  const key = getCacheKey(expression, options);
  const pageSize = options?.maxRows || 50;
  
  if (!dataCache.has(key)) {
    dataCache.set(key, {
      pageSize,
      totalCount: metadata.totalCount || 0,
      pages: new Map(),
      metadata,
    });
  }
  
  dataCache.get(key)!.pages.set(pageNum, rows);
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Register persistent sidebar panel ─────────────────────────────────────
  const visualizerView = new VisualizerView(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VisualizerView.viewType, visualizerView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ── Clear sidebar when debug session terminates ────────────────────────────
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(() => {
      visualizerView.clearData();
    })
  );

  // ── Command: right-click on a variable in the Variables panel ──────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dotnetVisualizer.visualizeFromVariables',
      async (item: unknown) => {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
          vscode.window.showErrorMessage('.NET Visualizer: no active debug session.');
          return;
        }

        // VS Code passes the variable tree item; extract evaluateName robustly
        const expression = extractEvaluateName(item);
        if (!expression) {
          vscode.window.showErrorMessage(
            '.NET Visualizer: cannot determine the variable expression. ' +
              'Try ".NET Visualizer: Visualize Expression" from the Command Palette instead.'
          );
          return;
        }

        await runVisualization(context, session, expression);
      }
    )
  );

  // ── Command: editor selection → right-click or Ctrl+Alt+V ─────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('dotnetVisualizer.visualizeSelection', async () => {
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        vscode.window.showErrorMessage(
          '.NET Visualizer: start a debug session and pause on a breakpoint first.'
        );
        return;
      }

      const editor = vscode.window.activeTextEditor;
      const selection = editor?.selection;
      let expression = editor && selection && !selection.isEmpty
        ? editor.document.getText(selection).trim()
        : undefined;

      // If nothing is selected, extract the member-access chain up to (and including)
      // the token under the cursor — but NOT beyond it.
      // Example: "dataTable.Rows.Count"
      //   cursor on "dataTable" → "dataTable"
      //   cursor on "Rows"      → "dataTable.Rows"
      //   cursor on "Count"     → "dataTable.Rows.Count"
      if (!expression && editor) {
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const col = editor.selection.active.character;

        // Extend forward to end of current identifier only (stop at '.' or '[')
        let end = col;
        while (end < line.length && /[a-zA-Z0-9_$]/.test(line[end])) { end++; }

        // Extend backward over the full dotted/indexed chain (e.g. "a.b[0].c")
        let start = col;
        while (start > 0 && /[a-zA-Z0-9_$.\[\]]/.test(line[start - 1])) { start--; }

        if (start < end) {
          expression = line.substring(start, end).trim();
        }
      }

      if (!expression) {
        vscode.window.showErrorMessage(
          '.NET Visualizer: select a variable name or expression in the editor first.'
        );
        return;
      }

      await runVisualization(context, session, expression);
    })
  );

  // ── Command: Command Palette → ask for expression ──────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('dotnetVisualizer.visualize', async () => {
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        vscode.window.showErrorMessage(
          '.NET Visualizer: start a debug session and pause on a breakpoint first.'
        );
        return;
      }

      const expression = await vscode.window.showInputBox({
        title: '.NET Data Visualizer',
        prompt: 'Enter a variable name or C# expression to visualize',
        placeHolder: 'e.g.  myDataTable  |  ds.Tables[0]  |  myList',
      });

      if (!expression?.trim()) {
        return;
      }

      await runVisualization(context, session, expression.trim());
    })
  );

  // ── Auto-update sidebar when the user clicks a variable in the editor
  // This listens for mouse-driven cursor moves and visualizes the word/chain
  // under the cursor. It only triggers for mouse selection events to avoid
  // noisy updates while typing.
  let _lastAutoExpr = '';
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(async (e) => {
      try {
        // Respect user setting to enable/disable live visualizer
        const cfg = vscode.workspace.getConfiguration('dotnetVisualizer');
        if (!cfg.get('liveVisualizer', true)) return;
        // Prefer mouse-driven selection events; if the enum is unavailable,
        // fall back to allowing the handler (best-effort).
        if (typeof (vscode as any).TextEditorSelectionChangeKind !== 'undefined') {
          if (e.kind !== (vscode as any).TextEditorSelectionChangeKind.Mouse) return;
        }

        const editor = e.textEditor;
        if (!editor) return;
        if (!editor.selection || !editor.selection.isEmpty) return;

        const pos = editor.selection.active;
        const line = editor.document.lineAt(pos.line).text;
        let col = pos.character;

        // Extend forward to end of current identifier only (stop at '.' or '[')
        let end = col;
        while (end < line.length && /[a-zA-Z0-9_$]/.test(line[end])) { end++; }

        // Extend backward over the full dotted/indexed chain (e.g. "a.b[0].c")
        let start = col;
        while (start > 0 && /[a-zA-Z0-9_$.\[\]]/.test(line[start - 1])) { start--; }

        if (start >= end) return;
        const expr = line.substring(start, end).trim();
        if (!expr) return;
        if (expr === _lastAutoExpr) return; // avoid repeated requests
        _lastAutoExpr = expr;

        const session = vscode.debug.activeDebugSession;
        if (!session) return;

        await runVisualization(context, session, expr);
      } catch {
        // ignore errors from selection handling
      }
    })
  );
  // Register command invoked by webview to request more data for the given expression.
  context.subscriptions.push(
    vscode.commands.registerCommand('dotnetVisualizer.requestMore', async (expr: string) => {
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        vscode.window.showErrorMessage('.NET Visualizer: no active debug session.');
        return;
      }
      // Read current config and request a larger fetch
      const cfg = vscode.workspace.getConfiguration('dotnetVisualizer');
      const baseRows = cfg.get<number>('maxRows', 50);
      const baseItems = cfg.get<number>('maxItems', 200);
      // Increase by one step: request base + base (double) rather than an aggressive multiply
      const bigger = { maxRows: Math.min(baseRows * 2, 5000), maxItems: Math.min(baseItems * 2, 20000) };
      await runVisualization(context, session, expr, bigger);
    })
  );

  // Register command to navigate between pages (invoked by webview pagination controls)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dotnetVisualizer.changePage',
      async (expr: string, pageNum: number, pageSize?: number) => {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
          vscode.window.showErrorMessage('.NET Visualizer: no active debug session.');
          return;
        }
        await navigateToPage(context, session, expr, pageNum, pageSize);
      }
    )
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to a specific page, using cache if available.
 * If the page is not cached, fetch it from the debugger.
 */
async function navigateToPage(
  context: vscode.ExtensionContext,
  session: vscode.DebugSession,
  expression: string,
  pageNum: number,
  pageSize?: number
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('dotnetVisualizer');
  const defaultPageSize = pageSize || cfg.get<number>('maxRows', 50);
  const options = { maxRows: defaultPageSize, maxItems: cfg.get<number>('maxItems', 200) };

  // Check if this page is already cached
  const cachedRows = getCachedPage(expression, pageNum, options);
  if (cachedRows) {
    // Serve from cache — instantly
    const view = VisualizerView.getInstance();
    const cacheEntry = dataCache.get(getCacheKey(expression, options));
    const fullData = Object.assign({}, cacheEntry!.metadata, {
      rows: cachedRows,
      currentPage: pageNum,
      pageSize: defaultPageSize,
      offset: (pageNum - 1) * defaultPageSize,
      __expression: expression,
    });
    await view?.sendData(fullData as any);
    return;
  }

  // Not cached — need to fetch it from debugger
  const offset = (pageNum - 1) * defaultPageSize;
  await runVisualization(context, session, expression, {
    maxRows: defaultPageSize,
    maxItems: options.maxItems,
    pageNum,
    offset,
  });
}

async function runVisualization(
  context: vscode.ExtensionContext,
  session: vscode.DebugSession,
  expression: string,
  options?: {
    maxRows?: number;
    maxItems?: number;
    pageNum?: number;
    offset?: number;
  }
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `.NET Visualizer: inspecting "${expression}"…`,
      cancellable: false,
    },
    async () => {
      try {
        const frameId = getActiveFrameId();
        const inspector = new DebugInspector(session, frameId, options);
        const view = VisualizerView.getInstance();
        
        // Send skeleton immediately when metadata is ready
        const onReady = async (skeleton: any) => {
          const now = new Date();
          const ms = String(now.getMilliseconds()).padStart(3, '0');
          const timeStr = now.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          console.log(`[${timeStr}.${ms}] onReady callback: sending skeleton with ${skeleton.columns.length} columns`);
          const payload = Object.assign({}, skeleton, { __expression: expression });
          await view?.sendData(payload);
        };
        
        // Progressive callback: send each row as it becomes available
        const onRowFetch = (rowIndex: number, rowData: string[]) => {
          const now = new Date();
          const ms = String(now.getMilliseconds()).padStart(3, '0');
          const timeStr = now.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          console.log(`[${timeStr}.${ms}] onRowFetch callback: row ${rowIndex}`);
          view?.sendRowUpdate(rowIndex, rowData);
        };
        
        const data = await inspector.inspect(expression, onReady, onRowFetch);
        // Attach the inspected expression so the webview can request more if needed
        const payload = Object.assign({}, data, { __expression: expression });
        
        // Cache the page data for data types that support pagination
        // Always cache data, even on first load (page 1)
        if ('rows' in data || 'items' in data || 'entries' in data) {
          const pageSize = options?.maxRows || 50;
          // If pageNum not specified, assume page 1 (offset 0)
          const pageNum = options?.pageNum ?? 1;
          const offset = options?.offset ?? 0;
          
          cachePageData(expression, pageNum, (data as any).rows || (data as any).items || (data as any).entries || [], data, options);
          (payload as any).pageSize = pageSize;
          (payload as any).currentPage = pageNum;
          (payload as any).offset = offset;
        }
        
        await view?.sendData(payload as any);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`.NET Visualizer: ${msg}`);
      }
    }
  );
}

// Command invoked by webview to request more data for the given expression.


/**
 * Try to read the active stack frame ID so the evaluate request is
 * scoped to the correct thread. Works on VS Code ≥ 1.90; silently
 * ignores the absence of the API on older versions.
 */
function getActiveFrameId(): number | undefined {
  try {
    // vscode.debug.activeStackItem was added in VS Code 1.90
    const stackItem = (vscode.debug as unknown as Record<string, unknown>).activeStackItem as
      | { frameId?: number }
      | undefined;
    return typeof stackItem?.frameId === 'number' ? stackItem.frameId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract the `evaluateName` from whatever VS Code passes as the command
 * argument when the user right-clicks a variable in the Variables panel.
 * The shape can differ across VS Code versions, so we probe several paths.
 */
function extractEvaluateName(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const obj = item as Record<string, unknown>;

  // Most common: { variable: { evaluateName: "..." } }
  const variable = obj['variable'];
  if (variable && typeof variable === 'object') {
    const en = (variable as Record<string, unknown>)['evaluateName'];
    if (typeof en === 'string' && en) {
      return en;
    }
    // fallback to .name
    const n = (variable as Record<string, unknown>)['name'];
    if (typeof n === 'string' && n) {
      return n;
    }
  }

  // Some versions pass the variable directly
  if (typeof obj['evaluateName'] === 'string' && obj['evaluateName']) {
    return obj['evaluateName'] as string;
  }
  if (typeof obj['name'] === 'string' && obj['name']) {
    return obj['name'] as string;
  }

  return undefined;
}

export function deactivate(): void {
  // nothing to clean up — subscriptions handled by context
}
