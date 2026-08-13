// Cross-tab change notifications. BroadcastChannel is unsupported in some
// embedded webviews — degrade to no-op (rev-based conflict detection in the
// repo still protects writes; only the early warning is lost).

export interface TabMessage {
  type: 'project-changed' | 'project-deleted';
  projectId: string;
  rev: number;
}

export interface TabChannel {
  post(msg: TabMessage): void;
  subscribe(handler: (msg: TabMessage) => void): () => void;
  close(): void;
}

export function createTabChannel(): TabChannel {
  if (typeof BroadcastChannel === 'undefined') {
    return { post: () => undefined, subscribe: () => () => undefined, close: () => undefined };
  }
  const channel = new BroadcastChannel('oneline-projects');
  return {
    post: (msg) => channel.postMessage(msg),
    subscribe: (handler) => {
      const listener = (e: MessageEvent) => handler(e.data as TabMessage);
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close: () => channel.close(),
  };
}
