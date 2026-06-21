import { vi } from "vitest";

type TauriEventHandler = (event: { event: string; id: number; payload: unknown }) => void;

const eventHandlers = new Map<string, Set<TauriEventHandler>>();

async function listenImplementation(event: string, handler: TauriEventHandler) {
  const handlers = eventHandlers.get(event) ?? new Set<TauriEventHandler>();
  handlers.add(handler);
  eventHandlers.set(event, handlers);

  const unlisten = vi.fn(() => {
    handlers.delete(handler);
  });
  unlistenMocks.push(unlisten);
  return unlisten;
}

export const invokeMock = vi.fn();
export const listenMock = vi.fn(listenImplementation);
export const getByLabelMock = vi.fn();
export const setFocusMock = vi.fn();
export const webviewWindowConstructorMock = vi.fn();
export const unlistenMocks: ReturnType<typeof vi.fn>[] = [];

export class WebviewWindowMock {
  static getByLabel = getByLabelMock;

  constructor(label: string, options: unknown) {
    webviewWindowConstructorMock(label, options);
  }
}

export function emitTauriEvent(event: string, payload: unknown) {
  for (const handler of eventHandlers.get(event) ?? []) {
    handler({ event, id: 1, payload });
  }
}

export function resetTauriMocks() {
  eventHandlers.clear();
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockImplementation(listenImplementation);
  getByLabelMock.mockReset();
  setFocusMock.mockReset();
  webviewWindowConstructorMock.mockReset();
  unlistenMocks.length = 0;
}
