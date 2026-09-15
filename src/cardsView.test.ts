import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

// Le module `vscode` n'existe qu'à l'intérieur de l'hôte d'extension : on ne simule que ce que CardsViewProvider touche.
vi.mock('vscode', () => {
  class EventEmitter<T> {
    private readonly listeners: Array<(value: T) => void> = [];
    readonly event = (listener: (value: T) => void): { dispose(): void } => {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    };
    fire(value: T): void {
      for (const listener of this.listeners) {
        listener(value);
      }
    }
  }
  return {
    EventEmitter,
    Uri: { joinPath: (base: { path: string }, ...parts: string[]) => ({ path: [base.path, ...parts].join('/') }) },
    env: { language: 'fr' },
    commands: { executeCommand: vi.fn(() => Promise.resolve()) },
  };
});

import { CardsViewProvider } from './cardsView';

function fakeView(visible: boolean): { view: vscode.WebviewView; posted: unknown[]; receive(message: unknown): void } {
  const posted: unknown[] = [];
  let listener: ((message: unknown) => void) | undefined;
  const view = {
    visible,
    badge: undefined,
    webview: {
      options: undefined,
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: (message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        listener = handler;
        return { dispose: () => undefined };
      },
    },
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: () => ({ dispose: () => undefined }),
  };
  return { view: view as unknown as vscode.WebviewView, posted, receive: (message) => listener?.(message) };
}

describe('CardsViewProvider.postState', () => {
  it('ne pousse pas l’état à une vue masquée (message perdu de toute façon, sérialisation évitée)', () => {
    const provider = new CardsViewProvider({ path: '/ext' } as unknown as vscode.Uri);
    const { view, posted } = fakeView(false);
    provider.resolveWebviewView(view);
    provider.postState({ tick: 1 });
    expect(posted).toEqual([]);
    (view as { visible: boolean }).visible = true;
    provider.postState({ tick: 2 });
    expect(posted).toEqual([{ tick: 2 }]);
  });

  it('rejoue le dernier état connu quand la vue est résolue', () => {
    const provider = new CardsViewProvider({ path: '/ext' } as unknown as vscode.Uri);
    provider.postState({ tick: 1 });
    const { view, posted } = fakeView(true);
    provider.resolveWebviewView(view);
    expect(posted).toEqual([{ tick: 1 }]);
  });
});

describe('CardsViewProvider — demandes de la webview', () => {
  beforeEach(() => {
    vi.mocked(vscode.commands.executeCommand).mockClear();
  });

  it('ouvre les réglages sur la clé demandée (lien de la card des limites)', () => {
    const provider = new CardsViewProvider({ path: '/ext' } as unknown as vscode.Uri);
    const { view, receive } = fakeView(true);
    provider.resolveWebviewView(view);
    receive({ type: 'openSetting', setting: 'claudeAgents.usageFile' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'claudeAgents.usageFile');
  });

  it('ouvre le menu d’affichage de l’usage (picto de la card des limites)', () => {
    const provider = new CardsViewProvider({ path: '/ext' } as unknown as vscode.Uri);
    const { view, receive } = fakeView(true);
    provider.resolveWebviewView(view);
    receive({ type: 'usageStatusMenu' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('claudeAgents.usageStatusBarMenu');
  });

  it('n’ouvre que les réglages de l’extension', () => {
    const provider = new CardsViewProvider({ path: '/ext' } as unknown as vscode.Uri);
    const { view, receive } = fakeView(true);
    provider.resolveWebviewView(view);
    receive({ type: 'openSetting', setting: 'editor.fontSize' });
    receive({ type: 'openSetting' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});
