import type { Message, MessageResponse, Step } from './types';

/**
 * Input shape for a step event — every field of the chosen Step variant
 * except the id and timestamp, which the background stamps. Use via the
 * per-kind helpers below (or the generic stepEvent<K>) to emit step events
 * without resorting to unsafe casts.
 */
export type StepInput<K extends Step['kind']> = Omit<Extract<Step, { kind: K }>, 'id' | 'ts'>;

export function stepEvent<K extends Step['kind']>(
  step: StepInput<K>,
): Extract<Message, { type: 'STEP_EVENT' }> {
  return { type: 'STEP_EVENT', step: step as unknown as Extract<Message, { type: 'STEP_EVENT' }>['step'] };
}

export function emitStep<K extends Step['kind']>(
  step: StepInput<K>,
): Promise<MessageResponse> {
  return send(stepEvent<K>(step));
}

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
