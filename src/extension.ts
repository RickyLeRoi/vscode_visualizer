import * as vscode from 'vscode';
import { DebugInspector } from './debugInspector';
import { VisualizerPanel } from './visualizerPanel';

export function activate(context: vscode.ExtensionContext): void {
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

      // If nothing is selected, fall back to the word under the cursor
      if (!expression && editor) {
        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (wordRange) {
          expression = editor.document.getText(wordRange).trim();
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runVisualization(
  context: vscode.ExtensionContext,
  session: vscode.DebugSession,
  expression: string
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
        const inspector = new DebugInspector(session, frameId);
        const data = await inspector.inspect(expression);
        VisualizerPanel.createOrShow(context.extensionUri, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`.NET Visualizer: ${msg}`);
      }
    }
  );
}

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
