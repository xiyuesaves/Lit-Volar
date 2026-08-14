import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { TextDocument } from 'vscode-html-languageservice';
import { litLifecycleCompletions } from '../lifecycleCompletion';

const litDeclarations = `
declare class ReactiveElement {
  connectedCallback(): void;
  disconnectedCallback(): void;
  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void;
  protected shouldUpdate(changedProperties: Map<PropertyKey, unknown>): boolean;
  protected willUpdate(changedProperties: Map<PropertyKey, unknown>): void;
  protected update(changedProperties: Map<PropertyKey, unknown>): void;
  protected firstUpdated(changedProperties: Map<PropertyKey, unknown>): void;
  protected updated(changedProperties: Map<PropertyKey, unknown>): void;
}
declare class LitElement extends ReactiveElement {
  protected render(): unknown;
}
`;

describe('Lit lifecycle completion', () => {
  it('offers TypeScript lifecycle snippets only inside LitElement classes', () => {
    const fixture = createFixture(`
${litDeclarations}
class Component extends LitElement {
  fir|
}
`);
    const items = completions(fixture);
    assert.deepEqual(items.map(item => item.label), ['firstUpdated']);
    assert.match(items[0].textEdit!.newText, /protected override firstUpdated/);
    assert.match(items[0].textEdit!.newText, /changedProperties: PropertyValues<this>/);
    assert.doesNotMatch(items[0].textEdit!.newText, /import\(/);
    assert.doesNotMatch(items[0].textEdit!.newText, /@lit\/reactive-element/);
    assert.equal(items[0].additionalTextEdits?.[0].newText, "import type { PropertyValues } from 'lit';\n");
  });

  it('omits lifecycle methods already implemented by the current class', () => {
    const fixture = createFixture(`
${litDeclarations}
class Component extends LitElement {
  protected override updated(): void {}
  |
}
`);
    const labels = completions(fixture).map(item => item.label);
    assert.ok(!labels.includes('updated'));
    assert.ok(labels.includes('firstUpdated'));
    assert.ok(labels.includes('render'));
  });

  it('does not offer render for ReactiveElement or any lifecycle for ordinary classes', () => {
    const reactive = createFixture(`
${litDeclarations}
class Component extends ReactiveElement {
  |
}
`);
    const reactiveLabels = completions(reactive).map(item => item.label);
    assert.ok(reactiveLabels.includes('willUpdate'));
    assert.ok(!reactiveLabels.includes('render'));
    const reactiveWillUpdate = completions(reactive).find(item => item.label === 'willUpdate');
    assert.match(reactiveWillUpdate!.textEdit!.newText, /changedProperties: PropertyValues<this>/);
    assert.equal(reactiveWillUpdate!.additionalTextEdits?.[0].newText,
      "import type { PropertyValues } from '@lit/reactive-element';\n");

    const ordinary = createFixture('class Component {\n  |\n}');
    assert.equal(completions(ordinary).length, 0);
  });

  it('uses JavaScript snippets without TypeScript syntax', () => {
    const fixture = createFixture(`
${litDeclarations}
class Component extends LitElement {
  upd|
}
`, 'fixture.js', 'javascript');
    const item = completions(fixture).find(candidate => candidate.label === 'updated');
    assert.ok(item);
    assert.match(item.textEdit!.newText, /^updated\(changedProperties\)/);
    assert.doesNotMatch(item.textEdit!.newText, /override|PropertyValues|: void/);
    assert.equal(item.additionalTextEdits, undefined);
  });

  it('reuses an existing PropertyValues type import', () => {
    const fixture = createFixture(`
import type { PropertyValues as LitChanges } from 'lit';
${litDeclarations}
class Component extends LitElement {
  upd|
}
`);
    const item = completions(fixture).find(candidate => candidate.label === 'updated');
    assert.ok(item);
    assert.match(item.textEdit!.newText, /changedProperties: LitChanges<this>/);
    assert.equal(item.additionalTextEdits, undefined);
  });

  it('offers methods between class members but not inside a method body', () => {
    const betweenMembers = createFixture(`
${litDeclarations}
class Component extends LitElement {
  one(): void {}
  |
  two(): void {}
}
`);
    assert.ok(completions(betweenMembers).some(item => item.label === 'firstUpdated'));

    const methodBody = createFixture(`
${litDeclarations}
class Component extends LitElement {
  method(): void {
    fir|
  }
}
`);
    assert.equal(completions(methodBody).length, 0);
  });
});

interface Fixture {
  document: TextDocument;
  offset: number;
  program: ts.Program;
  sourceFile: ts.SourceFile;
}

function createFixture(sourceWithMarker: string, fileName = 'fixture.ts', languageId = 'typescript'): Fixture {
  const offset = sourceWithMarker.lastIndexOf('|');
  const source = sourceWithMarker.slice(0, offset) + sourceWithMarker.slice(offset + 1);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) =>
    requested === fileName
      ? ts.createSourceFile(requested, source, languageVersion, true,
        languageId === 'javascript' ? ts.ScriptKind.JS : ts.ScriptKind.TS)
      : getSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = requested => requested === fileName || ts.sys.fileExists(requested);
  host.readFile = requested => requested === fileName ? source : ts.sys.readFile(requested);
  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName)!;
  return {
    document: TextDocument.create(`file:///${fileName}`, languageId, 1, source),
    offset,
    program,
    sourceFile,
  };
}

function completions(fixture: Fixture) {
  return litLifecycleCompletions(
    ts,
    fixture.program,
    fixture.sourceFile,
    fixture.offset,
    fixture.document,
  ) ?? [];
}
