import * as vscode from 'vscode';
import { rateBannerHtml } from './banner';
import { STRINGS, resolveLocale } from './i18n';
import { MENU_COMMAND } from './usageStatusBar';

export class CardsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claudeAgentsCards';

  private view?: vscode.WebviewView;
  private lastState: unknown;
  private lastBadge: vscode.ViewBadge | undefined;
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
    // La webview ne peut ni écrire la configuration ni ouvrir les réglages : elle le demande.
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const { type, setting } = message as { type?: unknown; setting?: unknown };
      if (type === 'dismissUsage') {
        // Croix de l'encart d'usage.
        void vscode.workspace
          .getConfiguration('claudeAgents')
          .update('showUsage', false, vscode.ConfigurationTarget.Global);
      } else if (type === 'openSetting' && typeof setting === 'string' && setting.startsWith('claudeAgents.')) {
        // Lien de l'encart d'usage vers le réglage à renseigner : réglages filtrés sur cette clé, et rien d'autre.
        void vscode.commands.executeCommand('workbench.action.openSettings', setting);
      } else if (type === 'usageStatusMenu') {
        // Picto de la card des limites : le même menu d'affichage que la flèche de la barre d'état.
        void vscode.commands.executeCommand(MENU_COMMAND);
      }
    });
    webviewView.onDidChangeVisibility(() => this.visibilityEmitter.fire(webviewView.visible));
    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.visibilityEmitter.fire(false);
    });
    if (this.lastState !== undefined) {
      void webviewView.webview.postMessage(this.lastState);
    }
    webviewView.badge = this.lastBadge;
    this.visibilityEmitter.fire(webviewView.visible);
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  /** Vue résolue au moins une fois (même masquée) : le badge de l'icône est alors affichable. */
  get resolved(): boolean {
    return this.view !== undefined;
  }

  /** Badge numérique sur l'icône de la barre d'activité ; undefined l'efface. */
  setBadge(badge: vscode.ViewBadge | undefined): void {
    this.lastBadge = badge;
    if (this.view) {
      this.view.badge = badge;
    }
  }

  /** Une vue masquée ne reçoit pas les messages (VS Code les ignore) : on s'épargne la sérialisation. */
  postState(state: unknown): void {
    this.lastState = state;
    if (this.visible) {
      void this.view?.webview.postMessage(state);
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'cards.css'));
    const nonce = getNonce();
    const locale = resolveLocale(vscode.env.language);
    return [
      '<!DOCTYPE html>',
      '<html lang="fr">',
      '<head>',
      '<meta charset="UTF-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`,
      `<link rel="stylesheet" href="${styleUri}">`,
      '</head>',
      '<body>',
      rateBannerHtml(locale),
      `<div id="root"><p class="empty">${STRINGS[locale].empty}</p></div>`,
      '<div id="usage"></div>',
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
