import * as vscode from 'vscode';
import { DebugInspector } from './debugInspector';
import { VisualizerView } from './visualizerView';

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runVisualization(
  context: vscode.ExtensionContext,
  session: vscode.DebugSession,
  expression: string,
  options?: { maxRows?: number; maxItems?: number }
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
        const data = await inspector.inspect(expression);
        // Attach the inspected expression so the webview can request more if needed
        const payload = Object.assign({}, data, { __expression: expression });
        await VisualizerView.getInstance()?.sendData(payload as any);
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
