import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IScriptSnapshot, VirtualCode } from '@volar/language-core';
import { getLanguageService, TextDocument } from 'vscode-html-languageservice';
import { URI } from 'vscode-uri';
import { createLitLanguagePlugin, languageIdFromPath, LitRootVirtualCode } from '../languagePlugin';

describe('Lit language plugin', () => {
  it('extracts HTML, CSS, and SVG templates from one source file', () => {
    const root = createRoot(`
      const a = html\`<button>OK</button>\`;
      const b = css\`:host { color: red; }\`;
      const c = svg\`<circle cx="10" />\`;
    `);

    assert.deepEqual(root.embeddedCodes.map(code => [code.id, code.languageId]), [
      ['html_0', 'html'],
      ['css_1', 'css'],
      ['svg_2', 'svg'],
    ]);
    assert.equal(textOf(root.embeddedCodes[2]), '<svg><circle cx="10" /></svg>');
  });

  it('ignores untagged and unknown tagged templates', () => {
    const root = createRoot('const a = `plain`; const b = other`unknown`;');
    assert.equal(root.embeddedCodes.length, 0);
  });

  it('replaces expressions without mapping placeholder text', () => {
    const source = 'const view = html`<p class=${kind}>Hello ${name}!</p>`;';
    const root = createRoot(source);
    const html = root.embeddedCodes[0];
    const virtualText = textOf(html);

    assert.equal(virtualText, '<p class=lit-expr-0>Hello lit-expr-1!</p>');
    assert.equal(virtualText.includes('kind'), false);
    assert.equal(virtualText.includes('name'), false);
    assert.equal(html.mappings.length, 3);
    assertMappedText(source, html);

    for (const mapping of html.mappings) {
      const start = mapping.generatedOffsets[0];
      const end = start + mapping.lengths[0];
      assert.equal(virtualText.slice(start, end).includes('lit-expr-'), false);
    }
  });

  it('creates CSS children for style elements at any HTML depth', () => {
    const source = `const view = html\`
      <section><div><style>.item { color: red; }</style></div></section>
    \`;`;
    const root = createRoot(source);
    const html = root.embeddedCodes[0];
    const style = html.embeddedCodes?.[0];

    assert.ok(style);
    assert.equal(style.languageId, 'css');
    assert.equal(textOf(style), '.item { color: red; }');
    assertMappedText(source, style);
  });

  it('preserves mapping holes for expressions inside style elements', () => {
    const source = 'const color = "red"; const view = html`<style>.item { color: ${color}; background: blue; }</style>`;';
    const root = createRoot(source);
    const style = root.embeddedCodes[0].embeddedCodes?.[0];

    assert.ok(style);
    assert.equal(textOf(style), '.item { color: lit-expr-0; background: blue; }');
    assert.equal(style.mappings.length, 2);
    assertMappedText(source, style);
    for (const mapping of style.mappings) {
      const start = mapping.generatedOffsets[0];
      const end = start + mapping.lengths[0];
      assert.equal(textOf(style).slice(start, end).includes('lit-expr-0'), false);
    }
  });

  it('keeps nested html templates inside map callbacks structurally independent', () => {
    const source = `
      const view = html\`
        <dl class="character-card__attributes">
          \${character.attributes.map(
            (attribute) => html\`
              <div class="character-card__attribute">
                <dt
                  class="character-card__attribute-label \${attribute.tone
                    ? \`character-card__attribute-label--\${attribute.tone}\`
                    : ""}"
                >
                  \${attribute.label}
                </dt>
                <dd class="character-card__attribute-value">\${attribute.value}</dd>
              </div>
            \`,
          )}
        </dl>
      \`;
    `;
    const root = createRoot(source);

    assert.equal(root.embeddedCodes.length, 2);
    const [outer, inner] = root.embeddedCodes;
    assert.match(textOf(outer), /<dl class="character-card__attributes">\s*lit-expr-0\s*<\/dl>/);
    assert.match(textOf(inner), /<div class="character-card__attribute">/);
    assert.match(textOf(inner), /character-card__attribute-label lit-expr-0/);
    assert.equal(textOf(outer).includes('attributes.map'), false);
    assert.equal(textOf(inner).includes('attribute.tone'), false);

    const htmlService = getLanguageService();
    for (const [index, code] of [outer, inner].entries()) {
      const document = TextDocument.create(`embedded://test/${index}.html`, 'html', 0, textOf(code));
      const htmlDocument = htmlService.parseHTMLDocument(document);
      assert.equal(htmlDocument.roots.length, 1);
      assert.equal(htmlDocument.roots[0].tag, index === 0 ? 'dl' : 'div');
      assert.equal(typeof htmlDocument.roots[0].endTagStart, 'number');
    }
  });

  it('matches configured aliases and qualified property access', () => {
    const plugin = createLitLanguagePlugin({ htmlTemplateTags: ['view'] });
    const source = 'const a = view`<p/>`; const b = lit.view`<div/>`;';
    const root = plugin.createVirtualCode?.(
      URI.file('/test.ts'),
      'typescript',
      snapshot(source),
      { getAssociatedScript: () => undefined },
    );

    assert.ok(root);
    assert.equal(root.embeddedCodes.length, 2);
  });

  it('gives CSS precedence over SVG and HTML duplicate tag config', () => {
    const plugin = createLitLanguagePlugin({
      htmlTemplateTags: ['view'],
      svgTemplateTags: ['view'],
      cssTemplateTags: ['view'],
    });
    const root = plugin.createVirtualCode?.(
      URI.file('/test.ts'),
      'typescript',
      snapshot('const x = view`color: red`;'),
      { getAssociatedScript: () => undefined },
    );

    assert.equal(root?.embeddedCodes[0].languageId, 'css');
  });

  it('infers all supported JS and TS file variants', () => {
    const cases: Record<string, string> = {
      'a.ts': 'typescript',
      'a.mts': 'typescript',
      'a.cts': 'typescript',
      'a.tsx': 'typescriptreact',
      'a.js': 'javascript',
      'a.mjs': 'javascript',
      'a.cjs': 'javascript',
      'a.jsx': 'javascriptreact',
    };
    for (const [file, expected] of Object.entries(cases)) {
      assert.equal(languageIdFromPath(`/project/${file}`), expected);
    }
    assert.equal(languageIdFromPath('/project/a.html'), undefined);
  });

  it('does not throw for an incomplete template while editing', () => {
    assert.doesNotThrow(() => createRoot('const x = html`<div class=${value')); 
  });
});

function createRoot(source: string): LitRootVirtualCode {
  const plugin = createLitLanguagePlugin();
  const root = plugin.createVirtualCode?.(
    URI.file('/test.ts'),
    'typescript',
    snapshot(source),
    { getAssociatedScript: () => undefined },
  );
  assert.ok(root);
  return root;
}

function snapshot(text: string): IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

function textOf(code: VirtualCode): string {
  return code.snapshot.getText(0, code.snapshot.getLength());
}

function assertMappedText(source: string, code: VirtualCode): void {
  const generated = textOf(code);
  for (const mapping of code.mappings) {
    const sourceStart = mapping.sourceOffsets[0];
    const generatedStart = mapping.generatedOffsets[0];
    const length = mapping.lengths[0];
    assert.equal(
      generated.slice(generatedStart, generatedStart + length),
      source.slice(sourceStart, sourceStart + length),
    );
  }
}
