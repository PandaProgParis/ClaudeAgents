import * as vscode from 'vscode';
import { STRINGS, resolveLocale } from './i18n';

export class CardsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claudeAgentsCards';

  private view?: vscode.WebviewView;
  private lastState: unknown;
  private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.onDidChangeVisibility(() => this.visibilityEmitter.fire(webviewView.visible));
    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.visibilityEmitter.fire(false);
    });
    if (this.lastState !== undefined) {
      void webviewView.webview.postMessage(this.lastState);
    }
    this.visibilityEmitter.fire(webviewView.visible);
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  postState(state: unknown): void {
    this.lastState = state;
    void this.view?.webview.postMessage(state);
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'cards.css'));
    const nonce = getNonce();
    return [
      '<!DOCTYPE html>',
      '<html lang="fr">',
      '<head>',
      '<meta charset="UTF-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`,
      `<link rel="stylesheet" href="${styleUri}">`,
      '</head>',
      '<body>',
      `<div id="root"><p class="empty">${STRINGS[resolveLocale(vscode.env.language)].empty}</p></div>`,
      `<script nonce="${nonce}" src="${scriptUri}"></script>`,
      '</body>',
      '</html>',
    ].join('\n');
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
