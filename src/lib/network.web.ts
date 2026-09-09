import { desktopError, getDesktopApi } from '@/lib/desktop';

export const sakaiFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const api = getDesktopApi();
  if (!api) return globalThis.fetch(input, init);
  const request = input instanceof Request ? input : undefined;
  const signal = init?.signal ?? request?.signal;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const id = crypto.randomUUID();
  const cancel = () => { void api.cancel(id).catch(() => undefined); };
  const headers = Object.fromEntries(new Headers(init?.headers ?? request?.headers));
  const body = init?.body ?? (request && !['GET', 'HEAD'].includes(request.method) ? await request.text() : undefined);
  if (body != null && typeof body !== 'string') throw new Error('El escritorio solo admite cuerpos de texto en esta peticion.');
  const result = api.request(id, {
    url: request?.url ?? String(input), method: init?.method ?? request?.method,
    headers, body: body ?? undefined, redirect: init?.redirect ?? request?.redirect,
  });
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const data = await result;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = new Response([204, 205, 304].includes(data.status) ? null : data.body, {
      status: data.status, statusText: data.statusText, headers: data.headers,
    });
    Object.defineProperty(response, 'url', { value: data.url });
    return response;
  } catch (cause) { throw desktopError(cause); }
  finally { signal?.removeEventListener('abort', cancel); }
}) as typeof globalThis.fetch;
