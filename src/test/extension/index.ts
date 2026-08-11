import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const timeout = 30_000;

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('local.lit-volar');
  assert.ok(extension, 'Lit Volar extension was not discovered');
  await extension.activate();

  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'project-consumer.ts'),
  );
  const editor = await vscode.window.showTextDocument(document);
  const originalEnd = document.positionAt(document.getText().length);
  const fixture = [
    '\nconst litVolarHighlight = 1;',
    'export const litVolarHighlightResult = litVolarHighlight + litVolarHighlight;',
    'export async function litVolarAsyncHighlight() {',
    '  return await Promise.resolve(litVolarHighlight);',
    '}',
    'export const extensionHostView = html`<button ',
  ].join('\n');
  await editor.edit(edit => edit.insert(originalEnd, fixture));
  editor.selection = new vscode.Selection(document.positionAt(document.getText().length), document.positionAt(document.getText().length));

  const highlightText = document.getText();
  const referenceOffset = highlightText.indexOf('litVolarHighlight +');
  await waitFor(async () => {
    const highlights = await documentHighlights(document, document.positionAt(referenceOffset));
    return highlights.filter(item => document.getText(item.range) === 'litVolarHighlight').length >= 3;
  });

  const asyncOffset = highlightText.indexOf('async function litVolarAsyncHighlight');
  await waitFor(async () => {
    const highlights = await documentHighlights(document, document.positionAt(asyncOffset));
    const highlightedText = new Set(highlights.map(item => document.getText(item.range)));
    return highlightedText.has('async') && highlightedText.has('await');
  });

  await vscode.commands.executeCommand('default:type', { text: '@cli' });
  await waitFor(async () => (await completions(document, editor.selection.active)).some(item => item.label === '@click'));
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await delay(500);
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await waitFor(() => Promise.resolve(document.getText().includes('@click=${}')));
  assert.equal(document.getText()[document.offsetAt(editor.selection.active) - 1], '{', 'Snippet cursor was not inside the Lit expression');

  const inputPosition = await replaceFixture(editor, originalEnd, '\nexport const extensionHostView = html`<input .va');
  const propertyItems = await completions(document, inputPosition);
  assert.equal(propertyItems.filter(item => item.label === '.value').length, 1);
  assert.match(completionText(propertyItems.find(item => item.label === '.value')), /=\\\$\{\$0\}$/);

  const booleanPosition = await replaceFixture(editor, originalEnd, '\nexport const extensionHostView = html`<button ?dis');
  const booleanItems = await completions(document, booleanPosition);
  assert.equal(booleanItems.filter(item => item.label === '?disabled').length, 1);

  const tagOffset = document.getText().indexOf('<project-card') + '<project-'.length;
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    document.uri,
    document.positionAt(tagOffset),
  );
  const hoverText = hovers.flatMap(hover => hover.contents).map(content =>
    typeof content === 'string' ? content : content.value).join('\n');
  assert.match(hoverText, /class ProjectCardElement \{/);
  assert.doesNotMatch(hoverText, /^const\s/m);

  const diagnosticPosition = await replaceFixture(
    editor,
    originalEnd,
    '\nexport const extensionHostView = html`<project-card .title=${123}></project-card>`',
  );
  assert.ok(diagnosticPosition);
  await waitFor(() => Promise.resolve(vscode.languages.getDiagnostics(document.uri)
    .some(diagnostic => diagnostic.code === 'no-incompatible-type-binding')));

  const config = vscode.workspace.getConfiguration('litVolar', document.uri);
  await config.update('globalEvents', ['refresh-event'], vscode.ConfigurationTarget.WorkspaceFolder);
  try {
    assert.deepEqual(
      vscode.workspace.getConfiguration('litVolar', document.uri).get('globalEvents'),
      ['refresh-event'],
    );
    const refreshPosition = await replaceFixture(editor, originalEnd, '\nexport const extensionHostView = html`<button @refresh');
    await waitFor(async () => (await completions(document, refreshPosition))
      .some(item => item.label === '@refresh-event'));
  }
  finally {
    await config.update('globalEvents', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  }

  const manifestUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'custom-elements.json');
  const originalManifest = await vscode.workspace.fs.readFile(manifestUri);
  try {
    const manifest = JSON.parse(Buffer.from(originalManifest).toString('utf8'));
    manifest.modules[0].declarations.push({
      kind: 'class',
      name: 'HotWidget',
      customElement: true,
      tagName: 'hot-widget',
      members: [],
    });
    await vscode.workspace.fs.writeFile(manifestUri, Buffer.from(JSON.stringify(manifest, null, 2)));
    const hotTagPosition = await replaceFixture(editor, originalEnd, '\nexport const extensionHostView = html`<hot-');
    await waitFor(async () => (await completions(document, hotTagPosition))
      .some(item => item.label === 'hot-widget'));
  }
  finally {
    await vscode.workspace.fs.writeFile(manifestUri, originalManifest);
  }

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

async function replaceFixture(
  editor: vscode.TextEditor,
  start: vscode.Position,
  text: string,
): Promise<vscode.Position> {
  const document = editor.document;
  await editor.edit(edit => edit.replace(new vscode.Range(start, document.positionAt(document.getText().length)), text));
  const position = document.positionAt(document.getText().length);
  editor.selection = new vscode.Selection(position, position);
  return position;
}

async function completions(document: vscode.TextDocument, position: vscode.Position, triggerCharacter?: string) {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    position,
    ...(triggerCharacter ? [triggerCharacter] : []),
  );
  return list?.items ?? [];
}

async function documentHighlights(document: vscode.TextDocument, position: vscode.Position) {
  return await vscode.commands.executeCommand<vscode.DocumentHighlight[]>(
    'vscode.executeDocumentHighlights',
    document.uri,
    position,
  ) ?? [];
}

function completionText(item: vscode.CompletionItem | undefined): string {
  if (!item) return '';
  if (item.textEdit && 'newText' in item.textEdit) return item.textEdit.newText;
  return typeof item.insertText === 'string' ? item.insertText : item.insertText?.value ?? '';
}

async function waitFor(check: () => Promise<boolean>, wait = timeout): Promise<void> {
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`Timed out after ${wait}ms`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
