'use strict';

const loadCjs = module.require.bind(module);

// React PR #35518 preserves the Forked tree-context flag during nested lazy
// replay so computed client useId values can match SSR. Exercise the installed
// Next-bundled React/server/client and SchedulerMock at controlled boundaries.
// https://github.com/facebook/react/pull/35518
process.env.NODE_ENV = 'development';

const assert = loadCjs('node:assert/strict');
const fs = loadCjs('node:fs');
const Module = loadCjs('node:module');
const path = loadCjs('node:path');
const { MessageChannel } = loadCjs('node:worker_threads');
const { Writable } = loadCjs('node:stream');

const webRoot = path.resolve(__dirname, '..');
const nextRoot = path.join(webRoot, 'node_modules/next');
const nextCompiled = path.join(nextRoot, 'dist/compiled');
const nextVersion = loadCjs(path.join(nextRoot, 'package.json')).version;

const React = loadCjs(path.join(nextCompiled, 'react/index.js'));
const ReactDOMServer = loadCjs(path.join(nextCompiled, 'react-dom/server.node.js'));
const ReactDOMClientPath = path.join(nextCompiled, 'react-dom/client.js');
const clientRendererPath = fs.realpathSync(
  path.join(nextCompiled, 'react-dom/cjs/react-dom-client.development.js'),
);
const schedulerRequest = 'next/dist/compiled/scheduler';
const schedulerMockPath = path.join(nextCompiled, 'scheduler/unstable_mock.js');
const SchedulerMock = loadCjs(schedulerMockPath);
const JSDOM = loadCjs(path.join(webRoot, 'node_modules/jsdom')).JSDOM;

const schedulerInterceptions = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const isClientRenderer =
    parent?.filename && fs.realpathSync(parent.filename) === clientRendererPath;
  if (isClientRenderer && request === schedulerRequest) {
    schedulerInterceptions.push(parent.filename);
    return SchedulerMock;
  }
  if (isClientRenderer && request.startsWith('next/dist/compiled/')) {
    return originalLoad.call(
      this,
      path.join(nextCompiled, request.slice('next/dist/compiled/'.length)),
      parent,
      isMain,
    );
  }
  return originalLoad.apply(this, arguments);
};

let ReactDOMClient;
try {
  ReactDOMClient = loadCjs(ReactDOMClientPath);
} finally {
  Module._load = originalLoad;
}

assert.equal(schedulerInterceptions.length, 1, 'expected to control the client renderer scheduler');
assert.equal(ReactDOMServer.version, React.version, 'bundled server renderer must match bundled React');
assert.equal(ReactDOMClient.version, React.version, 'bundled client renderer must match bundled React');

const componentNames = ['OuterComponent', 'InnerComponent', 'Sibling'];
const consoleOutput = { error: [], warn: [] };
const asyncErrors = [];
const originalConsole = { error: console.error, warn: console.warn };
for (const method of Object.keys(consoleOutput)) {
  console[method] = (...args) => {
    consoleOutput[method].push(args.map(compact).join(' '));
  };
}
const onUncaughtException = (error) => asyncErrors.push(compact(error));
const onUnhandledRejection = (reason) => asyncErrors.push(compact(reason));
process.on('uncaughtException', onUncaughtException);
process.on('unhandledRejection', onUnhandledRejection);

function compact(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function installDom(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.MutationObserver = window.MutationObserver;
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
}

function waitForMessageChannelTurn() {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

function sameLog(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function waitForExpectedYields(expected) {
  const preexistingYields = SchedulerMock.unstable_clearLog();
  const actual = [];
  do {
    await waitForMessageChannelTurn();
    if (!SchedulerMock.unstable_hasPendingWork()) break;
    SchedulerMock.unstable_flushNumberOfYields(expected.length - actual.length);
    actual.push(...SchedulerMock.unstable_clearLog());
    if (actual.length >= expected.length) {
      await waitForMessageChannelTurn();
      actual.push(...SchedulerMock.unstable_clearLog());
      break;
    }
  } while (true);

  assert.deepEqual(preexistingYields, [], 'scheduler yielded before the controlled boundary');
  assert(sameLog(actual, expected), `scheduler yield mismatch: ${JSON.stringify({ actual, expected })}`);
}

async function waitForAllExpectedYields(expected) {
  const preexistingYields = SchedulerMock.unstable_clearLog();
  do {
    await waitForMessageChannelTurn();
    if (!SchedulerMock.unstable_hasPendingWork()) break;
    SchedulerMock.unstable_flushAllWithoutAsserting();
  } while (true);
  const actual = SchedulerMock.unstable_clearLog();
  assert.deepEqual(preexistingYields, [], 'scheduler yielded before the final controlled boundary');
  assert(sameLog(actual, expected), `final scheduler yield mismatch: ${JSON.stringify({ actual, expected })}`);
}

function componentIdsFromEvents(events) {
  const ids = Object.fromEntries(componentNames.map((name) => [name, []]));
  for (const text of events) {
    const match = text.match(/^(OuterComponent|InnerComponent|Sibling) id: (.+)$/);
    if (match) ids[match[1]].push(match[2]);
  }
  return ids;
}

function domIdsByComponent(document) {
  const ids = Object.fromEntries(componentNames.map((name) => [name, []]));
  const componentByText = { outer: 'OuterComponent', inner: 'InnerComponent', sibling: 'Sibling' };
  for (const element of document.querySelectorAll('[id]')) {
    const component = componentByText[element.textContent];
    if (component) ids[component].push(element.id);
  }
  return ids;
}

async function renderServer(tree, serverErrors) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    writable.on('finish', () => resolve(chunks.join('')));
    writable.on('error', reject);
    let controller;
    let started = false;
    controller = ReactDOMServer.renderToPipeableStream(tree, {
      onAllReady() {
        if (started) return;
        started = true;
        controller.pipe(writable);
      },
      onShellError: reject,
      onError(error) {
        serverErrors.push(compact(error));
      },
    });
  });
}

async function run() {
  const events = [];
  const serverErrors = [];
  const hydrationErrors = [];
  const caughtErrors = [];
  const uncaughtErrors = [];
  let phase = 'server';
  const event = (text, logYield = true) => {
    events.push({ phase, text });
    if (logYield) SchedulerMock.log(text);
  };

  function InnerComponent() {
    const id = React.useId();
    event(`InnerComponent id: ${id}`);
    return React.createElement('span', { id }, 'inner');
  }

  function OuterComponent({ innerElement }) {
    const id = React.useId();
    event(`OuterComponent id: ${id}`);
    return React.createElement(
      React.Fragment,
      null,
      innerElement,
      React.createElement('span', { id, key: 'outer-label' }, 'outer'),
    );
  }

  function Sibling() {
    const id = React.useId();
    event(`Sibling id: ${id}`);
    return React.createElement('span', { id }, 'sibling');
  }

  const serverLazyInner = React.lazy(async () => {
    event('server lazy inner initializer');
    return { default: React.createElement(InnerComponent, { key: 'inner' }) };
  });
  const serverLazyOuter = React.lazy(async () => {
    event('server lazy outer initializer');
    return {
      default: React.createElement(OuterComponent, {
        key: 'outer',
        innerElement: serverLazyInner,
      }),
    };
  });
  const tree = (outer) =>
    React.createElement(
      'html',
      null,
      React.createElement(
        'body',
        null,
        React.createElement(React.Fragment, null, outer),
        React.createElement(React.Fragment, null, React.createElement(Sibling)),
      ),
    );

  const serverMarkup = await renderServer(tree(serverLazyOuter), serverErrors);
  const serverIdEvents = events.filter((item) => item.phase === 'server').map((item) => item.text);
  const serverIds = componentIdsFromEvents(serverIdEvents);
  for (const name of componentNames) {
    assert.equal(serverIds[name].length, 1, `expected one SSR useId for ${name}`);
  }
  const serverSchedulerYields = SchedulerMock.unstable_clearLog();
  assert.deepEqual(
    serverSchedulerYields,
    serverIdEvents,
    'SSR scheduler yields did not match the observed server events',
  );

  const activeDom = new JSDOM(serverMarkup, { url: 'https://fixture.invalid/' });
  installDom(activeDom.window);
  phase = 'client';
  let root;
  let resolveClientInner;
  let resolveClientOuter;
  const clientLazyInner = React.lazy(() => {
    event('client lazy inner initializer');
    const payload = { default: React.createElement(InnerComponent, { key: 'inner' }) };
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    resolveClientInner = () => {
      promise.status = 'fulfilled';
      promise.value = payload;
      resolvePromise(payload);
      event('client lazy inner resolved', false);
    };
    return promise;
  });
  const clientLazyOuter = React.lazy(() => {
    event('client lazy outer initializer');
    const payload = {
      default: React.createElement(OuterComponent, {
        key: 'outer',
        innerElement: clientLazyInner,
      }),
    };
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    resolveClientOuter = () => {
      promise.status = 'fulfilled';
      promise.value = payload;
      resolvePromise(payload);
      event('client lazy outer resolved', false);
    };
    return promise;
  });

  React.startTransition(() => {
    root = ReactDOMClient.hydrateRoot(activeDom.window.document, tree(clientLazyOuter), {
      onRecoverableError(error) {
        hydrationErrors.push(compact(error));
      },
      onCaughtError(error) {
        caughtErrors.push(compact(error));
      },
      onUncaughtError(error) {
        uncaughtErrors.push(compact(error));
      },
    });
  });

  await waitForExpectedYields(['client lazy outer initializer']);
  assert.equal(typeof resolveClientOuter, 'function', 'outer lazy did not suspend at its boundary');
  resolveClientOuter();

  await waitForExpectedYields([
    `OuterComponent id: ${serverIds.OuterComponent[0]}`,
    'client lazy inner initializer',
  ]);
  assert.equal(typeof resolveClientInner, 'function', 'inner lazy did not suspend at its boundary');
  resolveClientInner();

  const expectedFinalYields = [
    `OuterComponent id: ${serverIds.OuterComponent[0]}`,
    `InnerComponent id: ${serverIds.InnerComponent[0]}`,
    `Sibling id: ${serverIds.Sibling[0]}`,
  ];
  await waitForAllExpectedYields(expectedFinalYields);

  const clientIdEvents = events.filter((item) => item.phase === 'client').map((item) => item.text);
  const clientIds = componentIdsFromEvents(clientIdEvents);
  assert.deepEqual(
    Object.fromEntries(componentNames.map((name) => [name, clientIds[name].length])),
    { OuterComponent: 2, InnerComponent: 1, Sibling: 1 },
    'hydration render counts changed',
  );
  for (const name of componentNames) {
    assert(
      clientIds[name].every((id) => id === serverIds[name][0]),
      `${name} computed a useId that differs from SSR`,
    );
  }

  const finalDomIds = domIdsByComponent(activeDom.window.document);
  const serverDom = new JSDOM(serverMarkup, { url: 'https://fixture.invalid/' });
  const serverDomIds = domIdsByComponent(serverDom.window.document);
  assert.deepEqual(finalDomIds, serverDomIds, 'hydrated DOM IDs differ from the SSR DOM IDs');
  assert.equal(SchedulerMock.unstable_hasPendingWork(), false, 'scheduler work remains after final hydration');
  assert.deepEqual(consoleOutput.warn, [], 'unexpected console warnings during hydration');
  assert.deepEqual(consoleOutput.error, [], 'unexpected console errors during hydration');
  assert.deepEqual(hydrationErrors, [], 'unexpected recoverable hydration errors');
  assert.deepEqual(caughtErrors, [], 'unexpected caught React errors');
  assert.deepEqual(uncaughtErrors, [], 'unexpected uncaught React errors');
  assert.deepEqual(serverErrors, [], 'unexpected server rendering errors');
  assert.deepEqual(asyncErrors, [], 'unexpected uncaught or unhandled process errors');

  root.unmount();
  activeDom.window.close();
  serverDom.window.close();

  return {
    nextVersion,
    bundledReactVersion: React.version,
    rendererVersionsMatch: true,
    schedulerAliasVerified: schedulerInterceptions.length === 1,
    serverIds,
    clientIds,
    clientRenderCounts: { OuterComponent: 2, InnerComponent: 1, Sibling: 1 },
    finalYieldOrder: expectedFinalYields,
    domMatchesSSR: true,
    consoleWarnings: consoleOutput.warn.length,
    consoleErrors: consoleOutput.error.length,
    recoverableErrors: hydrationErrors.length,
    caughtErrors: caughtErrors.length,
    uncaughtErrors: uncaughtErrors.length,
    serverErrors: serverErrors.length,
    asyncErrors: asyncErrors.length,
    pendingSchedulerWork: false,
  };
}

run()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${compact(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const method of Object.keys(originalConsole)) {
      console[method] = originalConsole[method];
    }
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
  });
