import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import ts from 'typescript';
import { BindingRegistry } from '../bindingRegistry';
import type { CemProjectData } from '../cemData';
import { defaultConfig } from '../config';

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-volar-bindings-'));
const sourceFile = path.join(fixtureRoot, 'fixture.ts');
fs.writeFileSync(sourceFile, 'export {};');
after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

const emptyCem: CemProjectData = { elements: new Map(), htmlData: [], manifestFiles: [] };

function createProgram() {
  return ts.createProgram([sourceFile], {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true,
  });
}

describe('BindingRegistry DOM metadata', () => {
  it('provides tag-specific writable properties, events, and boolean attributes', () => {
    const program = createProgram();
    const registry = new BindingRegistry(ts, defaultConfig, fixtureRoot);
    const button = registry.getBindings('button', program, undefined, emptyCem);
    const input = registry.getBindings('input', program, undefined, emptyCem);
    const select = registry.getBindings('select', program, undefined, emptyCem);
    const circle = registry.getBindings('circle', program, undefined, emptyCem);

    assert.ok(button.some(item => item.modifier === '.' && item.name === 'disabled'));
    assert.ok(button.some(item => item.modifier === '@' && item.name === 'click' && item.type === 'PointerEvent'));
    assert.ok(button.some(item => item.modifier === '?' && item.name === 'disabled'));
    assert.ok(input.some(item => item.modifier === '.' && item.name === 'value'));
    assert.ok(input.some(item => item.modifier === '?' && item.name === 'checked'));
    assert.ok(!input.some(item => item.modifier === '.' && item.name === 'labels'));
    assert.ok(select.some(item => item.modifier === '.' && item.name === 'selectedIndex'));
    assert.ok(circle.some(item => item.modifier === '@' && item.name === 'click'));
    assert.ok(!circle.some(item => item.modifier === '.' && item.name === 'getAttribute'));
  });

  it('keeps CEM metadata ahead of DOM metadata and suppresses property attributes', () => {
    const program = createProgram();
    const registry = new BindingRegistry(ts, defaultConfig, fixtureRoot);
    const cem: CemProjectData = {
      manifestFiles: [],
      htmlData: [],
      elements: new Map([['input', {
        name: 'input',
        attributes: [{ name: 'value', type: 'string', analysisType: 'string' }, { name: 'mode' }],
        properties: [{ name: 'value', type: "'cem'", analysisType: "'cem'" }],
        events: [], slots: [], cssParts: [], cssProperties: [],
      }]]),
    };
    const bindings = registry.getBindings('input', program, undefined, cem);
    assert.equal(bindings.find(item => item.modifier === '.' && item.name === 'value')?.type, "'cem'");
    assert.ok(!bindings.some(item => item.modifier === '' && item.name === 'value'));
    assert.ok(bindings.some(item => item.modifier === '' && item.name === 'mode'));
  });
});
