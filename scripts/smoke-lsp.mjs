import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const serverPath = path.resolve('dist/server.js');
const child = spawn(process.execPath, [serverPath, '--stdio'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
let stdoutBuffer = Buffer.alloc(0);
let stderr = '';
const pending = new Map();

child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => {
  stderr += chunk;
});

child.stdout.on('data', chunk => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
  parseMessages();
});

function parseMessages() {
  while (true) {
    const headerEnd = stdoutBuffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = stdoutBuffer.subarray(0, headerEnd).toString('ascii');
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
    assert.ok(lengthMatch, `Invalid LSP header: ${header}`);
    const contentLength = Number(lengthMatch[1]);
    const messageEnd = headerEnd + 4 + contentLength;
    if (stdoutBuffer.length < messageEnd) return;

    const body = stdoutBuffer.subarray(headerEnd + 4, messageEnd).toString('utf8');
    stdoutBuffer = stdoutBuffer.subarray(messageEnd);
    const message = JSON.parse(body);

    if (message.id !== undefined && message.method) {
      send({ jsonrpc: '2.0', id: message.id, result: null });
      continue;
    }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    }
  }
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function request(method, params, timeoutMs = 10_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}. Server stderr:\n${stderr}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: result => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: error => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function positionAt(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length - 1, character: lines.at(-1).length };
}

async function completionAt(sourceWithMarker, fileName) {
  const markerOffset = sourceWithMarker.indexOf('|');
  assert.notEqual(markerOffset, -1, 'Completion fixture must include a marker');
  const text = sourceWithMarker.slice(0, markerOffset) + sourceWithMarker.slice(markerOffset + 1);
  const uri = pathToFileURL(path.resolve('.lsp-smoke', fileName)).href;

  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  const completion = await request('textDocument/completion', {
    textDocument: { uri },
    position: positionAt(text, markerOffset),
    context: { triggerKind: 1 },
  });
  notify('textDocument/didClose', { textDocument: { uri } });
  return Array.isArray(completion) ? completion : completion?.items ?? [];
}

function labels(items) {
  return items.map(item => item.label.toLowerCase());
}

try {
  const initializeResult = await request('initialize', {
    processId: null,
    rootUri: pathToFileURL(process.cwd()).href,
    workspaceFolders: [{ uri: pathToFileURL(process.cwd()).href, name: 'lit-volar' }],
    capabilities: {
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport: true,
            insertReplaceSupport: true,
          },
        },
      },
      workspace: {},
    },
    initializationOptions: { litVolar: {} },
  });
  assert.ok(initializeResult.capabilities.completionProvider, 'Server did not advertise completion');
  notify('initialized', {});

  const htmlItems = await completionAt('const view = html`<bu|`;', 'html.ts');
  assert.ok(labels(htmlItems).includes('button'), 'HTML completion did not include button');

  const litBindingItems = await completionAt('const view = html`<button @|></button>`;', 'binding.ts');
  assert.ok(labels(litBindingItems).includes('@click'), 'Lit completion did not include @click');

  const cssItems = await completionAt('const styles = css`:host { col| }`;', 'css.ts');
  assert.ok(labels(cssItems).includes('color'), 'CSS completion did not include color');

  const nestedRuleItems = await completionAt(
    'const styles = css`.record-panel__header { .record-panel__code { col| } }`;',
    'nested-rule.ts',
  );
  assert.ok(labels(nestedRuleItems).includes('color'), 'Nested CSS rule completion did not include color');

  const nestedCssItems = await completionAt(
    'const view = html`<section><style>.item { col| }</style></section>`;',
    'nested-style.ts',
  );
  assert.ok(labels(nestedCssItems).includes('color'), 'Nested style completion did not include color');

  const svgItems = await completionAt('const icon = svg`<cir|`;', 'svg.ts');
  assert.ok(labels(svgItems).includes('circle'), 'SVG completion did not include circle');

  const interpolationItems = await completionAt(
    'const model = { value: 1 }; const view = html`<p>${model.|}</p>`;',
    'interpolation.ts',
  );
  assert.equal(interpolationItems.length, 0, 'Volar should defer interpolation completion to TypeScript');

  await request('shutdown', null);
  notify('exit');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not exit.\n${stderr}`)), 5_000);
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Server exited with code ${code}.\n${stderr}`));
    });
  });

  console.log('LSP smoke passed: HTML, Lit bindings, CSS, nested style, SVG, interpolation isolation, and shutdown.');
}
catch (error) {
  child.kill();
  throw error;
}
