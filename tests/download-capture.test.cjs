const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
  process.env.U1_CAPTURE_SCRIPT || path.join(__dirname, '..', 'injected.js'),
  'utf8'
);
const requestUrl = 'https://makerworld.com/api/v1/design/instance/123/f3mf';
const settle = () => new Promise(resolve => setImmediate(resolve));

function createHarness() {
  const window = new EventTarget();
  window.postMessage = () => {};
  window.fetch = () => Promise.resolve(new Response('PK-source'));

  class FakeXHR extends EventTarget {
    open(...args) {
      this.openArguments = args;
      this.responseType = '';
    }
    send(...args) {
      this.sendArguments = args;
      if (this.sendError) throw this.sendError;
    }
    complete(status, response, responseType = '') {
      this.status = status;
      this.response = response;
      this.responseType = responseType;
      this.responseText = response;
      this.dispatchEvent(new Event('loadend'));
    }
  }

  const files = [];
  const errors = [];
  window.addEventListener('__u1_3mf', event => files.push(JSON.parse(event.detail)));
  window.addEventListener('__u1_3mf_err', event => errors.push(event.detail));

  vm.runInNewContext(source, {
    window,
    document: new EventTarget(),
    XMLHttpRequest: FakeXHR,
    CustomEvent,
    URL,
    Blob,
    console: { log() {}, warn() {}, error() {} },
  }, { filename: 'injected.js' });

  function message(data) {
    const event = new Event('message');
    Object.assign(event, { source: window, data });
    window.dispatchEvent(event);
  }
  return {
    window, FakeXHR, files, errors,
    arm: () => message({ __u1StartCapture: true }),
    cancel: () => message({ __u1CancelCapture: true }),
    cleanup: () => files.forEach(file => URL.revokeObjectURL(file.blobUrl)),
  };
}

for (const [type, body, expected] of [
  ['', '{"url":"https://example.com/model.3mf"}', '{"url":"https://example.com/model.3mf"}'],
  ['text', '{"name":"ghost.3mf"}', '{"name":"ghost.3mf"}'],
  ['json', { name: 'ghost.3mf' }, '{"name":"ghost.3mf"}'],
  ['arraybuffer', new TextEncoder().encode('PK-source').buffer, 'PK-source'],
  ['blob', new Blob(['PK-source']), 'PK-source'],
]) {
  test(`captures XHR ${type || 'default text'} without changing the native response`, async t => {
    const h = createHarness();
    t.after(h.cleanup);
    h.arm();
    const xhr = new h.FakeXHR();
    let nativeListenerCalls = 0;
    xhr.addEventListener('loadend', () => nativeListenerCalls++);
    xhr.open('GET', requestUrl, true);
    xhr.send(null);
    xhr.complete(200, body, type);
    await settle();
    assert.equal(h.files.length, 1);
    assert.equal(h.files[0].requestUrl, requestUrl);
    assert.equal(await (await fetch(h.files[0].blobUrl)).text(), expected);
    assert.equal(xhr.response, body);
    assert.equal(xhr.responseType, type);
    assert.equal(nativeListenerCalls, 1);
    assert.deepEqual(xhr.openArguments, ['GET', requestUrl, true]);
    assert.deepEqual(xhr.sendArguments, [null]);
  });
}

test('ignores inactive captures and unrelated XHR URLs', async t => {
  const h = createHarness();
  t.after(h.cleanup);
  const inactive = new h.FakeXHR();
  inactive.open('GET', requestUrl);
  inactive.send();
  // Starting capture while an earlier, unarmed request is in flight must not
  // turn that earlier response into the selected profile's download.
  h.arm();
  inactive.complete(200, 'PK-inactive');
  const unrelated = new h.FakeXHR();
  unrelated.open('GET', 'https://makerworld.com/api/v1/design/123');
  unrelated.send();
  unrelated.complete(200, '{}');
  await settle();
  assert.equal(h.files.length, 0);
  assert.equal(h.errors.length, 0);
  assert.equal(h.window.__u1Capturing, true);
});

for (const status of [0, 403, 418, 500]) {
  test(`reports XHR status ${status} through the existing error event`, async t => {
    const h = createHarness();
    t.after(h.cleanup);
    h.arm();
    const xhr = new h.FakeXHR();
    xhr.open('GET', requestUrl);
    xhr.send();
    xhr.complete(status, 'error');
    await settle();
    assert.deepEqual(h.errors, [status]);
    assert.equal(h.files.length, 0);
    assert.equal(h.window.__u1Capturing, false);
  });
}

test('cancelled request cannot satisfy a later capture', async t => {
  const h = createHarness();
  t.after(h.cleanup);
  h.arm();
  const old = new h.FakeXHR();
  old.open('GET', requestUrl);
  old.send();
  h.cancel();
  h.arm();
  old.complete(200, 'PK-old');
  await settle();
  assert.equal(h.files.length, 0);
  assert.equal(h.window.__u1Capturing, true);
  const current = new h.FakeXHR();
  current.open('GET', requestUrl);
  current.send();
  current.complete(200, 'PK-current');
  await settle();
  assert.equal(await (await fetch(h.files[0].blobUrl)).text(), 'PK-current');
});

test('cancel during asynchronous Blob reading discards the old response', async t => {
  const h = createHarness();
  t.after(h.cleanup);
  let finishRead;
  const blob = { arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) };
  h.arm();
  const xhr = new h.FakeXHR();
  xhr.open('GET', requestUrl);
  xhr.send();
  xhr.complete(200, blob, 'blob');
  h.cancel();
  h.arm();
  finishRead(new ArrayBuffer(4));
  await settle();
  assert.equal(h.files.length, 0);
  assert.equal(h.window.__u1Capturing, true);
});

test('send errors propagate unchanged and do not leave a capture listener behind', async t => {
  const h = createHarness();
  t.after(h.cleanup);
  h.arm();
  const xhr = new h.FakeXHR();
  xhr.open('GET', requestUrl);
  xhr.sendError = new Error('native send error');
  assert.throws(() => xhr.send(), error => error === xhr.sendError);
  xhr.complete(200, 'PK-not-sent');
  await settle();
  assert.equal(h.files.length, 0);
});

test('only one concurrent download response is delivered', async t => {
  const h = createHarness();
  t.after(h.cleanup);
  h.arm();
  const requests = [new h.FakeXHR(), new h.FakeXHR()];
  requests.forEach(xhr => { xhr.open('GET', requestUrl); xhr.send(); });
  requests.forEach(xhr => xhr.complete(200, 'PK-source'));
  await settle();
  assert.equal(h.files.length, 1);
});

test('existing fetch capture still leaves the page response readable', async t => {
  const h = createHarness();
  t.after(h.cleanup);
  h.arm();
  const response = await h.window.fetch(requestUrl);
  await settle();
  assert.equal(await response.text(), 'PK-source');
  assert.equal(h.files.length, 1);
  assert.equal(await (await fetch(h.files[0].blobUrl)).text(), 'PK-source');
});
