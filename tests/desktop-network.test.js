const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DesktopNetwork, sanitizeResponseHeaders } = require('../desktop/network.cjs');

function sessionMock() {
  const handlers = {};
  const session = {
    webRequest: {
      onBeforeRequest(handler) { handlers.beforeRequest = handler; },
      onBeforeSendHeaders(handler) { handlers.beforeSendHeaders = handler; },
      onHeadersReceived(handler) { handlers.headersReceived = handler; },
      onCompleted(handler) { handlers.completed = handler; },
      onErrorOccurred(handler) { handlers.errorOccurred = handler; },
    },
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    on() {},
  };
  return { handlers, session };
}

test('removes response header values that Undici cannot represent as ByteStrings', () => {
  const result = sanitizeResponseHeaders({
    'Content-Type': ['application/pdf'],
    'Content-Disposition': ['attachment; filename="apuntes\ufffd.pdf"'],
    'X-Valid-Latin-1': ['Espa\u00f1a'],
  });

  assert.deepEqual(result, {
    headers: { 'Content-Type': ['application/pdf'], 'X-Valid-Latin-1': ['Espa\u00f1a'] },
    invalidLocation: false,
  });
});

test('sanitizes malformed download headers before Electron passes them to Undici', () => {
  const { handlers, session } = sessionMock();
  const network = new DesktopNetwork(session);
  network.requests.set(1, {});
  let response;

  assert.doesNotThrow(() => handlers.headersReceived({
    id: 1,
    statusCode: 200,
    responseHeaders: {
      'Content-Type': ['application/pdf'],
      'Content-Disposition': ['attachment; filename="tema\ufffd.pdf"'],
    },
  }, (value) => { response = value; }));

  assert.deepEqual(response, {
    cancel: false,
    responseHeaders: { 'Content-Type': ['application/pdf'] },
  });
});

test('turns an invalid redirect location into a controlled redirect failure', async () => {
  const { handlers, session } = sessionMock();
  session.fetch = async (url, init) => {
    handlers.beforeSendHeaders({ id: 2, url, method: 'GET', requestHeaders: init.headers }, () => undefined);
    handlers.headersReceived({
      id: 2,
      statusCode: 302,
      responseHeaders: { Location: [`https://poliformat.upv.es/access/content/tema\ufffd.pdf`] },
    }, () => undefined);
    throw new Error('Electron rejected the response');
  };
  const network = new DesktopNetwork(session);

  await assert.rejects(
    network.fetchOne('https://poliformat.upv.es/access/content/file.pdf', {
      method: 'GET', headers: {}, body: undefined,
    }, new AbortController().signal),
    (error) => error.code === 'REDIRECT',
  );
});
