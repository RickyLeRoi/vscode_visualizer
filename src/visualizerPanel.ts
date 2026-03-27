import * as vscode from 'vscode';
import { VisualizerData } from './types';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');
}

export class VisualizerPanel {
  public static currentPanel: VisualizerPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _disposables: vscode.Disposable[] = [];

  // ─── Static factory ─────────────────────────────────────────────────────────

  public static createOrShow(extensionUri: vscode.Uri, data: VisualizerData): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (VisualizerPanel.currentPanel) {
      VisualizerPanel.currentPanel._panel.reveal(column);
      VisualizerPanel.currentPanel._sendData(data);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'dotnetVisualizer',
      '.NET Data Visualizer',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    VisualizerPanel.currentPanel = new VisualizerPanel(panel, extensionUri);
    VisualizerPanel.currentPanel._sendData(data);
  }

  // ─── Constructor ────────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set initial HTML immediately so the webview can load scripts
    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  // ─── Send data to webview ───────────────────────────────────────────────────

  private _sendData(data: VisualizerData): void {
    // Rebuild HTML to reset state when switching variables
    this._panel.webview.html = this._buildHtml(this._panel.webview);
    // Small delay ensures the webview script is ready to receive messages
    setTimeout(() => {
      this._panel.webview.postMessage({ command: 'update', data });
    }, 100);
  }

  public static sendRowUpdate(rowIndex: number, rowData: string[]): void {
    if (VisualizerPanel.currentPanel) {
      VisualizerPanel.currentPanel._panel.webview.postMessage({
        command: 'row-update',
        rowIndex,
        rowData,
      });
    }
  }

  // ─── HTML builder ────────────────────────────────────────────────────────────

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
    <span id="title" class="vis-title">⏳ Loading…</span>
    <div class="actions">
      <input type="text" id="searchInput" placeholder="🔍 Filter…" />
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

  // ─── Dispose ─────────────────────────────────────────────────────────────────

  public dispose(): void {
    VisualizerPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}
