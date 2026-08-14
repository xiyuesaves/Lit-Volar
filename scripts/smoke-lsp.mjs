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

async function completionAt(sourceWithMarker, fileName, context = { triggerKind: 1 }) {
  const markerOffset = sourceWithMarker.indexOf('|');
  assert.notEqual(markerOffset, -1, 'Completion fixture must include a marker');
  const text = sourceWithMarker.slice(0, markerOffset) + sourceWithMarker.slice(markerOffset + 1);
  const uri = pathToFileURL(path.resolve(fileName.includes('/') ? fileName : path.join('.lsp-smoke', fileName))).href;

  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  const completion = await request('textDocument/completion', {
    textDocument: { uri },
    position: positionAt(text, markerOffset),
    context,
  });
  notify('textDocument/didClose', { textDocument: { uri } });
  return Array.isArray(completion) ? completion : completion?.items ?? [];
}

async function completionAtUntilLabel(
  sourceWithMarker,
  fileName,
  expectedLabel,
  context = { triggerKind: 1 },
  timeoutMs = 10_000,
) {
  const markerOffset = sourceWithMarker.indexOf('|');
  assert.notEqual(markerOffset, -1, 'Completion fixture must include a marker');
  const text = sourceWithMarker.slice(0, markerOffset) + sourceWithMarker.slice(markerOffset + 1);
  const uri = pathToFileURL(path.resolve(fileName.includes('/') ? fileName : path.join('.lsp-smoke', fileName))).href;
  const deadline = Date.now() + timeoutMs;
  let items = [];

  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  try {
    // Project discovery is incremental because each analyzer completion has a small time budget.
    do {
      const completion = await request('textDocument/completion', {
        textDocument: { uri },
        position: positionAt(text, markerOffset),
        context,
      });
      items = Array.isArray(completion) ? completion : completion?.items ?? [];
      if (labels(items).includes(expectedLabel.toLowerCase())) return items;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    return items;
  }
  finally {
    notify('textDocument/didClose', { textDocument: { uri } });
  }
}

async function requestAt(sourceWithMarker, fileName, method, params = {}) {
  const markerOffset = sourceWithMarker.indexOf('|');
  assert.notEqual(markerOffset, -1, `${method} fixture must include a marker`);
  const text = sourceWithMarker.slice(0, markerOffset) + sourceWithMarker.slice(markerOffset + 1);
  const uri = pathToFileURL(path.resolve(fileName)).href;
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  const result = await request(method, {
    textDocument: { uri },
    position: positionAt(text, markerOffset),
    ...params,
  }, 20_000);
  notify('textDocument/didClose', { textDocument: { uri } });
  return result;
}

async function autoInsertAt(sourceWithMarker, fileName) {
  const markerOffset = sourceWithMarker.indexOf('|');
  assert.notEqual(markerOffset, -1, 'Auto-insertion fixture must include a marker');
  const text = sourceWithMarker.slice(0, markerOffset) + sourceWithMarker.slice(markerOffset + 1);
  assert.equal(text[markerOffset - 1], '=', 'Auto-insertion marker must follow an equals sign');
  const uri = pathToFileURL(path.resolve(fileName)).href;
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  const result = await request('volar/client/autoInsert', {
    textDocument: { uri },
    selection: positionAt(text, markerOffset),
    change: { rangeOffset: markerOffset - 1, rangeLength: 0, text: '=' },
  }, 20_000);
  notify('textDocument/didClose', { textDocument: { uri } });
  return result;
}

async function diagnosticsAndActions(sourceWithMarker, fileName) {
  const markerOffset = sourceWithMarker.indexOf('|');
  const text = sourceWithMarker.slice(0, markerOffset) + sourceWithMarker.slice(markerOffset + 1);
  const uri = pathToFileURL(path.resolve(fileName)).href;
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text },
  });
  const report = await request('textDocument/diagnostic', { textDocument: { uri } }, 20_000);
  const diagnostics = report?.items ?? [];
  const target = diagnostics.find(item => item.code === 'no-missing-import');
  const actions = target ? await request('textDocument/codeAction', {
    textDocument: { uri },
    range: target.range,
    context: { diagnostics: [target], only: ['quickfix'], triggerKind: 1 },
  }, 20_000) : [];
  notify('textDocument/didClose', { textDocument: { uri } });
  return { diagnostics, actions };
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
        diagnostic: {},
      },
      workspace: {},
    },
    initializationOptions: {
      typescript: {
        tsdk: path.join(process.cwd(), 'node_modules', 'typescript', 'lib'),
      },
      litVolar: {
        globalEvents: ['refresh-event'],
      },
    },
  });
  assert.ok(initializeResult.capabilities.completionProvider, 'Server did not advertise completion');
  assert.ok(initializeResult.capabilities.completionProvider.triggerCharacters?.includes('@'),
    'Server did not advertise @ as a completion trigger');
  assert.ok(initializeResult.capabilities.completionProvider.triggerCharacters?.includes('?'),
    'Server did not advertise ? as a completion trigger');
  assert.equal(initializeResult.capabilities.documentHighlightProvider, undefined,
    'Server advertised document highlights for entire TypeScript documents');
  notify('initialized', {});

  const htmlItems = await completionAt('const view = html`<bu|`;', 'html.ts');
  assert.ok(labels(htmlItems).includes('button'), 'HTML completion did not include button');

  const litBindingItems = await completionAt(
    'const view = html`<button @|></button>`;',
    'binding.ts',
    { triggerKind: 2, triggerCharacter: '@' },
  );
  assert.ok(labels(litBindingItems).includes('@click'), 'Lit completion did not include @click');
  const clickCompletion = litBindingItems.find(item => item.label === '@click');
  assert.equal(clickCompletion?.textEdit?.newText ?? clickCompletion?.insertText, '@click=\\${$0}',
    'Built-in Lit event completion used an HTML quoted value');

  const clickAutoInsert = await autoInsertAt('const view = html`<button @click=|></button>`;', 'binding.ts');
  assert.equal(clickAutoInsert, '\\${$0}', 'Built-in Lit event binding did not replace quotes with a Lit expression');

  const configuredEventItems = await completionAt(
    'const view = html`<button @ref|></button>`;',
    'binding.ts',
  );
  assert.ok(labels(configuredEventItems).includes('@refresh-event'), 'Configured global event completion was missing');

  const propertyBindingItems = await completionAt('const view = html`<input .va|>`;', 'binding.ts');
  const valueCompletion = propertyBindingItems.find(item => item.label === '.value');
  assert.equal(valueCompletion?.textEdit?.newText ?? valueCompletion?.insertText, '.value=\\${$0}',
    'Built-in Lit property completion used an HTML quoted value');

  const booleanBindingItems = await completionAt(
    'const view = html`<button ?|></button>`;',
    'binding.ts',
    { triggerKind: 2, triggerCharacter: '?' },
  );
  const disabledCompletion = booleanBindingItems.find(item => item.label === '?disabled');
  assert.equal(disabledCompletion?.textEdit?.newText ?? disabledCompletion?.insertText, '?disabled=\\${$0}',
    'Built-in Lit boolean completion used an HTML quoted value');

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

  const lifecycleItems = await completionAt(
    "import { LitElement } from 'lit'; class LifecycleCard extends LitElement { fir| }",
    'samples/lifecycle-card.ts',
  );
  const firstUpdatedItem = lifecycleItems.find(item => item.label === 'firstUpdated');
  assert.ok(firstUpdatedItem, 'Lit lifecycle completion did not include firstUpdated');
  assert.match(firstUpdatedItem.textEdit?.newText ?? firstUpdatedItem.insertText ?? '',
    /protected override firstUpdated\(changedProperties: PropertyValues<this>\)/,
    'Lit lifecycle completion did not insert the TypeScript override signature');
  assert.equal(firstUpdatedItem.additionalTextEdits?.[0]?.newText,
    "import type { PropertyValues } from 'lit';\n",
    'Lit lifecycle completion did not add the PropertyValues type import');

  const ordinaryLifecycleItems = await completionAt(
    'class OrdinaryClass { fir| }',
    'samples/ordinary-class.ts',
  );
  assert.ok(!labels(ordinaryLifecycleItems).includes('firstUpdated'),
    'Lit lifecycle completion leaked into an ordinary class');

  const projectTagItems = await completionAtUntilLabel(
    "import { html } from 'lit'; const view = html`<pro|`;",
    'samples/project-consumer.ts',
    'project-card',
  );
  assert.ok(labels(projectTagItems).includes('project-card'), 'Project TypeScript metadata did not complete project-card');

  const projectPropertyItems = await completionAt(
    "import { html } from 'lit'; const view = html`<project-card .ti|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(projectPropertyItems).includes('.title'), 'Project property completion did not include .title');
  const projectPropertyItem = projectPropertyItems.find(item => item.label === '.title');
  const projectPropertyInsert = projectPropertyItem?.textEdit?.newText ?? projectPropertyItem?.insertText ?? '';
  assert.match(projectPropertyInsert, /=\\\$\{\$0\}$/, 'Project property completion did not insert a Lit expression');

  const projectBooleanItems = await completionAt(
    "import { html } from 'lit'; const view = html`<project-card ?ac|></project-card>`;",
    'samples/project-consumer.ts',
  );
  const projectBooleanItem = projectBooleanItems.find(item => item.label === '?active');
  assert.ok(projectBooleanItem, 'Project boolean attribute completion did not include ?active');
  assert.match(projectBooleanItem.textEdit?.newText ?? projectBooleanItem.insertText ?? '', /=\\\$\{\$0\}$/,
    'Project boolean attribute completion did not insert a Lit expression');

  const projectTestPropertyItems = await completionAt(
    "import { html } from 'lit'; const view = html`<project-card .te|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(projectTestPropertyItems).includes('.test'), 'Project property completion did not include .test');
  const projectTestAttributeItems = await completionAt(
    "import { html } from 'lit'; const view = html`<project-card te|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(!labels(projectTestAttributeItems).includes('test'), 'Reactive project property was also suggested as an unprefixed attribute');

  const projectPropertyAutoInsert = await autoInsertAt(
    "import { html } from 'lit'; const view = html`<project-card .title=|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.equal(projectPropertyAutoInsert, '\\${$0}', 'Known project property binding did not replace quotes with a Lit expression');
  const unknownPropertyAutoInsert = await autoInsertAt(
    "import { html } from 'lit'; const view = html`<project-card .missing=|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.equal(unknownPropertyAutoInsert, '"$1"', 'Unknown property binding did not retain HTML quote insertion');

  const cemTagItems = await completionAt(
    "import { html } from 'lit'; const view = html`<cem-|`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(cemTagItems).includes('cem-widget'), 'CEM auto-discovery did not complete cem-widget');

  const cemAttributeItems = await completionAt(
    "import { html } from 'lit'; const view = html`<cem-widget @se|></cem-widget>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(cemAttributeItems).includes('@select'), 'CEM event completion did not include @select');
  const cemPropertyAttributeItems = await completionAt(
    "import { html } from 'lit'; const view = html`<cem-widget co|></cem-widget>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(!labels(cemPropertyAttributeItems).includes('count'), 'CEM property was also suggested as an unprefixed attribute');
  const cemStandaloneAttributeItems = await completionAt(
    "import { html } from 'lit'; const view = html`<cem-widget va|></cem-widget>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(cemStandaloneAttributeItems).includes('variant'), 'Standalone CEM attribute completion was incorrectly removed');
  const cemPropertyAutoInsert = await autoInsertAt(
    "import { html } from 'lit'; const view = html`<cem-widget .count=|></cem-widget>`;",
    'samples/project-consumer.ts',
  );
  assert.equal(cemPropertyAutoInsert, '\\${$0}', 'Known CEM property binding did not replace quotes with a Lit expression');

  const cemSlotItems = await completionAt(
    "import { html } from 'lit'; const view = html`<cem-widget><span slot=\"he|\"></span></cem-widget>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(cemSlotItems).includes('header'), 'CEM slot completion did not include header');

  const cemCssItems = await completionAt(
    "import { css } from 'lit'; const styles = css`:host { color: var(--cem-|) }`;",
    'samples/project-consumer.ts',
  );
  assert.ok(labels(cemCssItems).includes('--cem-widget-color'), 'CEM CSS property completion was missing');

  const cemCssDefinition = await requestAt(
    "import { css } from 'lit'; const styles = css`:host { color: var(--cem-widget-col|or) }`;",
    'samples/project-consumer.ts',
    'textDocument/definition',
  );
  assert.ok(Array.isArray(cemCssDefinition) && cemCssDefinition.some(item =>
    (item.targetUri ?? item.uri)?.toLowerCase().includes('/samples/cem-widget.js')),
    'CEM CSS property definition did not target its source module');

  const projectCssDefinition = await requestAt(
    "import { css } from 'lit'; const styles = css`:host { --card-accent: red; color: var(--card-acc|ent); }`;",
    'samples/project-consumer.ts',
    'textDocument/definition',
  );
  assert.ok(Array.isArray(projectCssDefinition) && projectCssDefinition.some(item =>
    (item.targetUri ?? item.uri)?.toLowerCase().includes('/samples/project-consumer.ts')),
    'Project CSS custom property definition was missing');

  const hover = await requestAt(
    "import { html } from 'lit'; const view = html`<cem-wid|get></cem-widget>`;",
    'samples/project-consumer.ts',
    'textDocument/hover',
  );
  assert.match(hover?.contents?.value ?? '', /Custom Elements Manifest/, 'CEM Hover documentation was missing');

  const litInstanceHover = await requestAt(
    "import { html } from 'lit'; import './project-card'; const view = html`<project-c|ard></project-card>`;",
    'samples/project-consumer.ts',
    'textDocument/hover',
  );
  const litInstanceText = litInstanceHover?.contents?.value ?? '';
  assert.equal(litInstanceHover?.contents?.kind, 'markdown', 'Lit instance Hover was not normalized as highlighted Markdown');
  assert.match(litInstanceText, /^```typescript/m, 'Lit instance Hover did not request TypeScript code highlighting');
  assert.equal((litInstanceText.match(/class ProjectCardElement \{/g) ?? []).length, 1, 'Lit instance Hover returned duplicate Quick Info');
  assert.match(litInstanceText, /^class ProjectCardElement \{/m, 'Lit instance Hover did not use the declared class name');
  assert.doesNotMatch(litInstanceText, /^const\s/m, 'Lit instance Hover used a synthetic const declaration');
  assert.match(litInstanceText, /title: string;/, 'Lit instance Hover did not show public reactive properties');
  assert.match(litInstanceText, /active: boolean;/, 'Lit instance Hover did not show boolean inputs');
  assert.match(litInstanceText, /"@activate": CustomEvent<\{ active: boolean; \}>;/, 'Lit instance Hover did not show event payload types');
  assert.doesNotMatch(litInstanceText, /\/\/ attribute:/, 'Lit instance Hover included generated attribute comments');
  assert.doesNotMatch(litInstanceText, /Inheritance|Declared in|\| Binding \|/, 'Lit instance Hover included documentation UI instead of Quick Info');

  const propertyHover = await requestAt(
    "import { html } from 'lit'; import './project-card'; const view = html`<project-card .dat|a=${{ id: 1 }}></project-card>`;",
    'samples/project-consumer.ts',
    'textDocument/hover',
  );
  const propertyHoverText = propertyHover?.contents?.value ?? '';
  assert.match(propertyHoverText, /^```typescript/m, 'Property Hover did not use TypeScript code highlighting');
  assert.match(propertyHoverText, /\(property\) ProjectCardElement\.data: ProjectCardData/,
    'Property Hover did not use the standard TypeScript Quick Info display string');

  const inheritedHover = await requestAt(
    "import { html } from 'lit'; import './api-card'; const view = html`<api-c|ard></api-card>`;",
    'samples/project-consumer.ts',
    'textDocument/hover',
  );
  const inheritedHoverText = inheritedHover?.contents?.value ?? '';
  assert.match(inheritedHoverText, /^class ApiCardElement \{/m, 'Inherited API Hover did not use the concrete class');
  assert.match(inheritedHoverText, /value9: number;/, 'Lit instance Hover still truncated reactive properties');
  assert.match(inheritedHoverText, /inheritedLabel: string;/, 'Lit instance Hover omitted project-base reactive properties');
  assert.match(inheritedHoverText, /"@commit": CustomEvent<\{ id: number; \}>;/, 'Lit instance Hover omitted public events');
  assert.doesNotMatch(inheritedHoverText, /renderRoot|updateComplete|shadowRoot/, 'Lit instance Hover exposed framework members');

  const definition = await requestAt(
    "import { html } from 'lit'; import './project-card'; const view = html`<project-c|ard></project-card>`;",
    'samples/project-consumer.ts',
    'textDocument/definition',
  );
  assert.ok(Array.isArray(definition) && definition.some(item =>
    (item.targetUri ?? item.uri)?.toLowerCase().includes('/samples/project-card.ts')),
    'Project tag definition did not target project-card.ts');

  const rename = await requestAt(
    "import { html } from 'lit'; import './project-card'; const view = html`<project-c|ard></project-card>`;",
    'samples/project-consumer.ts',
    'textDocument/rename',
    { newName: 'renamed-card' },
  );
  assert.ok(rename?.changes && Object.keys(rename.changes).some(uri => uri.endsWith('/samples/project-card.ts')),
    'Project rename did not include the component declaration file');

  const analysis = await diagnosticsAndActions(
    "import { html } from 'lit'; const view = html`<project-|card></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(analysis.diagnostics.some(item => item.code === 'no-missing-import'), 'Missing import diagnostic was not reported');
  assert.ok(analysis.actions.some(action => action.edit), 'Missing import quick fix did not contain a WorkspaceEdit');

  const bindingAnalysis = await diagnosticsAndActions(
    "import { html } from 'lit'; import './project-card'; const view = html`<project-card .title=${123}|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(bindingAnalysis.diagnostics.some(item => item.code === 'no-incompatible-type-binding'),
    'Default project binding type diagnostic was not reported');

  const unknownTagAnalysis = await diagnosticsAndActions(
    "import { html } from 'lit'; const view = html`<unknown-widget|></unknown-widget>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(unknownTagAnalysis.diagnostics.some(item => item.code === 'no-unknown-tag-name'),
    'Default profile did not report an unknown custom element');

  const unknownPropertyAnalysis = await diagnosticsAndActions(
    "import { html } from 'lit'; import './project-card'; const view = html`<project-card .missing=${'value'}|></project-card>`;",
    'samples/project-consumer.ts',
  );
  assert.ok(unknownPropertyAnalysis.diagnostics.some(item => item.code === 'no-unknown-property'),
    'Default profile did not report an unknown property binding');

  const syntaxAnalysis = await diagnosticsAndActions(
    "import { html } from 'lit'; const view = html`<div><div></div>|`;",
    'samples/project-consumer.ts',
  );
  assert.ok(syntaxAnalysis.diagnostics.some(item => item.code === 'no-unclosed-tag'),
    'Default syntax profile did not report an unclosed tag');

  const cssAnalysis = await diagnosticsAndActions(
    "import { css } from 'lit'; const styles = css`:host { color: #xyz;| }`;",
    'samples/project-consumer.ts',
  );
  assert.ok(cssAnalysis.diagnostics.some(item => item.code === 'no-invalid-css' && item.source === 'lit-volar'),
    'Modern CSS diagnostics were not wrapped as no-invalid-css');

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

  console.log('LSP smoke passed: embedded services, project/CEM metadata, binding insertion, diagnostics, fixes, navigation, rename, and shutdown.');
}
catch (error) {
  child.kill();
  throw error;
}
