import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { defaultConfig } from '../config';
import { findLitCssClassDefinitions, htmlClassTokenAt } from '../cssClassDefinitions';

const declarations = `
declare function css(strings: TemplateStringsArray, ...values: unknown[]): unknown;
declare function html(strings: TemplateStringsArray, ...values: unknown[]): unknown;
declare class LitElement {}
`;

describe('Lit CSS class definitions', () => {
  it('recognizes individual tokens in quoted class attributes', () => {
    const text = '<div class="one two three"></div>';
    const token = htmlClassTokenAt(text, text.indexOf('two') + 1);
    assert.deepEqual(token, {
      name: 'two',
      start: text.indexOf('two'),
      end: text.indexOf('two') + 3,
    });
    assert.equal(htmlClassTokenAt('<div id="two"></div>', 10), undefined);
  });

  it('returns every matching selector in the owning component without leaking from siblings', () => {
    const fixture = createFixture(`
${declarations}
class OtherCard extends LitElement {
  static styles = css\`.shared { color: red; }\`;
}
class CurrentCard extends LitElement {
  static styles = css\`
    .shared { color: blue; }
    .wrapper .shared { font-weight: bold; }
    .ignored { content: ".shared {"; }
    /* .shared { color: black; } */
  \`;
  render() { return html\`<div class="shared| wrapper"></div>\`; }
}
`);
    const definitions = findDefinitions(fixture, 'shared');
    assert.equal(definitions.length, 2);
    const currentClassStart = fixture.source.indexOf('class CurrentCard');
    assert.ok(definitions.every(definition => definition.start > currentClassStart));
    assert.ok(definitions.every(definition =>
      fixture.source.slice(definition.start, definition.end) === 'shared'));
  });

  it('includes explicitly referenced shared styles and project base class styles', () => {
    const fixture = createFixture(`
${declarations}
const sharedStyles = css\`.shared-token { display: block; }\`;
class BaseCard extends LitElement {
  static styles = css\`.base-token { color: red; }\`;
}
class CurrentCard extends BaseCard {
  static styles = [super.styles, sharedStyles, css\`.local-token { color: blue; }\`];
  render() { return html\`<div class="base-token shared-token local-token|"></div>\`; }
}
`);
    assert.equal(findDefinitions(fixture, 'base-token').length, 1);
    assert.equal(findDefinitions(fixture, 'shared-token').length, 1);
    assert.equal(findDefinitions(fixture, 'local-token').length, 1);
  });

  it('follows imported shared styles through the TypeScript symbol graph', () => {
    const fixture = createFilesFixture({
      'fixture.ts': `
${declarations}
import { sharedStyles } from './shared';
class CurrentCard extends LitElement {
  static styles = [sharedStyles, css\`.local-token { color: blue; }\`];
  render() { return html\`<div class="shared-token|"></div>\`; }
}
`,
      'shared.ts': `
declare function css(strings: TemplateStringsArray, ...values: unknown[]): unknown;
export const sharedStyles = css\`.shared-token { display: block; }\`;
`,
    });
    const definitions = findDefinitions(fixture, 'shared-token');
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].fileName, 'shared.ts');
  });

  it('inherits base styles only when styles are inherited or explicitly included', () => {
    const inherited = createFixture(`
${declarations}
class BaseCard extends LitElement {
  static styles = css\`.base-token { color: red; }\`;
}
class CurrentCard extends BaseCard {
  render() { return html\`<div class="base-token|"></div>\`; }
}
`);
    assert.equal(findDefinitions(inherited, 'base-token').length, 1);

    const overridden = createFixture(`
${declarations}
class BaseCard extends LitElement {
  static styles = css\`.base-token { color: red; }\`;
}
class CurrentCard extends BaseCard {
  static styles = css\`.local-token { color: blue; }\`;
  render() { return html\`<div class="base-token|"></div>\`; }
}
`);
    assert.equal(findDefinitions(overridden, 'base-token').length, 0);
  });

  it('finds inline style definitions but avoids unrelated unscoped css templates', () => {
    const scoped = createFixture(`
${declarations}
class CurrentCard extends LitElement {
  render() {
    return html\`<style>.inline-token, .inline-token { color: red; }</style><div class="inline-token|"></div>\`;
  }
}
`);
    assert.equal(findDefinitions(scoped, 'inline-token').length, 2);

    const unscoped = createFixture(`
${declarations}
const unrelated = css\`.loose-token { color: red; }\`;
const view = html\`<div class="loose-token|"></div>\`;
`);
    assert.equal(findDefinitions(unscoped, 'loose-token').length, 0);
  });
});

interface Fixture {
  offset: number;
  program: ts.Program;
  source: string;
  sourceFile: ts.SourceFile;
}

function createFixture(sourceWithMarker: string): Fixture {
  return createFilesFixture({ 'fixture.ts': sourceWithMarker });
}

function createFilesFixture(filesWithMarker: Record<string, string>): Fixture {
  const fileName = 'fixture.ts';
  const sourceWithMarker = filesWithMarker[fileName];
  const offset = sourceWithMarker.lastIndexOf('|');
  const source = sourceWithMarker.slice(0, offset) + sourceWithMarker.slice(offset + 1);
  const files = new Map(Object.entries({ ...filesWithMarker, [fileName]: source }));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) =>
    files.has(requested)
      ? ts.createSourceFile(requested, files.get(requested)!, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = requested => files.has(requested) || ts.sys.fileExists(requested);
  host.readFile = requested => files.get(requested) ?? ts.sys.readFile(requested);
  host.resolveModuleNames = moduleNames => moduleNames.map(moduleName => {
    const resolvedFileName = `${moduleName.replace(/^\.\//, '')}.ts`;
    return files.has(resolvedFileName) ? {
      resolvedFileName,
      extension: ts.Extension.Ts,
      isExternalLibraryImport: false,
    } : undefined;
  });
  const program = ts.createProgram([...files.keys()], options, host);
  return {
    offset,
    program,
    source,
    sourceFile: program.getSourceFile(fileName)!,
  };
}

function findDefinitions(fixture: Fixture, className: string) {
  return findLitCssClassDefinitions(
    ts,
    fixture.program,
    fixture.sourceFile,
    fixture.offset,
    className,
    defaultConfig,
  );
}
