import type { Message, MessageResponse } from './types';

export async function send<T = unknown>(msg: Message): Promise<MessageResponse<T>> {
  try {
    const resp = (await chrome.runtime.sendMessage(msg)) as MessageResponse<T> | undefined;
    return resp ?? { ok: false, error: 'no-response' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function sendToTab<T = unknown>(tabId: number, msg: Message): Promise<MessageResponse<T>> {
  try {
    const resp = (await chrome.tabs.sendMessage(tabId, msg)) as MessageResponse<T> | undefined;
    return resp ?? { ok: false, error: 'no-response' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function onMessage(
  handler: (msg: Message, sender: chrome.runtime.MessageSender) => Promise<MessageResponse> | MessageResponse,
): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    Promise.resolve(handler(msg as Message, sender))
      .then((resp) => sendResponse(resp))
      .catch((e) => sendResponse({ ok: false, error: (e as Error).message }));
    return true; // keep channel open for async
  });
}

export function uid(prefix = ''): string {
  const r = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}
