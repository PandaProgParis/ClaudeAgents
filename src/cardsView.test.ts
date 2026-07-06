import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

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
  };
});

import { CardsViewProvider } from './cardsView';

function fakeView(visible: boolean): { view: vscode.WebviewView; posted: unknown[] } {
  const posted: unknown[] = [];
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
    },
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: () => ({ dispose: () => undefined }),
  };
  return { view: view as unknown as vscode.WebviewView, posted };
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
