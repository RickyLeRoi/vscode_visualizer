import * as vscode from 'vscode';
import { VisualizerData } from './types';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');
}

/**
 * Persistent sidebar panel that stays open and updates on every
 * "Visualize" action. Implemented as a WebviewViewProvider so it
 * lives in the VS Code activity-bar side panel instead of opening
 * a full-screen editor tab.
 */
export class VisualizerView implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dotnetVisualizer.sidePanel';

  private static _instance: VisualizerView | undefined;

  private _view: vscode.WebviewView | undefined;
  private _pendingData: VisualizerData | undefined;
  private readonly _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
    VisualizerView._instance = this;
  }

  public static getInstance(): VisualizerView | undefined {
    return VisualizerView._instance;
  }

  // ─── WebviewViewProvider implementation ────────────────────────────────────

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    // Re-apply toolbar button state when panel becomes visible again
    // (needed because retainContextWhenHidden preserves old button visibility).
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        webviewView.webview.postMessage({ command: 'rerender' });
      }
    });

    // Handle messages FROM the webview
    webviewView.webview.onDidReceiveMessage((msg: any) => {
      if (!msg || !msg.command) return;
      if (msg.command === 'requestMore' && typeof msg.expression === 'string') {
        // Forward to extension command which will perform a re-inspect with larger limits
        vscode.commands.executeCommand('dotnetVisualizer.requestMore', msg.expression);
      } else if (msg.command === 'changePage' && typeof msg.expression === 'string' && typeof msg.pageNum === 'number') {
        // Forward pagination request to extension command
        vscode.commands.executeCommand('dotnetVisualizer.changePage', msg.expression, msg.pageNum, msg.pageSize);
      }
    });

    // If sendData() was called before the view was visible, deliver now.
    if (this._pendingData) {
      const data = this._pendingData;
      this._pendingData = undefined;
      setTimeout(() => {
        webviewView.webview.postMessage({ command: 'update', data });
      }, 120);
    }

    // When the view is hidden and re-shown, webview context is preserved
    // because retainContextWhenHidden is set via options — nothing extra needed.
  }

  // ─── Public API called by commands ─────────────────────────────────────────

  /**
   * Push new data to the sidebar panel.
   * If the panel is not yet visible, it reveals it first then delivers the data.
   */
  public async sendData(data: VisualizerData): Promise<void> {
    if (this._view) {
      // Panel already resolved — reveal without stealing focus, then update.
      this._view.show(true);
      this._view.webview.postMessage({ command: 'update', data });
    } else {
      // Panel hasn't been opened yet. Store data, then open the container.
      // resolveWebviewView will pick up _pendingData once the view loads.
      this._pendingData = data;
      await vscode.commands.executeCommand(`${VisualizerView.viewType}.focus`);
    }
  }

  /**
   * Clear the sidebar when the debug session ends.
   * Shows "Start debugger first" message.
   */
  public clearData(): void {
    if (this._view) {
      this._view.webview.postMessage({ command: 'clear' });
    } else {
      this._pendingData = undefined;
    }
  }

  /**
   * Send a progressive row update to the webview as it becomes available.
   */
  public sendRowUpdate(rowIndex: number, rowData: string[]): void {
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const timeStr = now.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.error(`[${timeStr}.${ms}] sendRowUpdate: row ${rowIndex}, data length ${rowData.length}`);
    if (this._view) {
      this._view.webview.postMessage({
        command: 'row-update',
        rowIndex,
        rowData,
      });
    }
  }

  // ─── HTML builder (same structure as VisualizerPanel) ──────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
    );
    const mdUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'markdown-it.min.js')
    );
    const csp = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp}; script-src 'nonce-${nonce}' ${mdUri} ${scriptUri};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesUri}">
  <title>.NET Data Visualizer</title>
</head>
<body>
  <div id="toolbar">
    <span id="title" class="vis-title">⏳ Waiting for data…</span>
    <div class="actions">
      <input type="text" id="searchInput" placeholder="🔍 Filter…" />
      <button id="btnOpenValue" class="btn" style="display:none">View</button>
      <button id="btnShowMore" class="btn" style="display:none">Show More</button>
      <button id="btnExportCsv" class="btn">Export CSV</button>
      <button id="btnCopyClip" class="btn">Copy</button>
    </div>
  </div>
  <div id="tabs-container"></div>
  <div id="content"></div>
  <div id="status-bar"></div>
  <script src="${mdUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
