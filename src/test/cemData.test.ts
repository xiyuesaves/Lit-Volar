import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { loadCemProjectData } from '../cemData';
import { defaultConfig } from '../config';

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-volar-cem-'));
after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

describe('Custom Elements Manifest metadata', () => {
  it('discovers package metadata and exposes all custom element features', () => {
    fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ customElements: 'metadata/custom-elements.json' }));
    fs.mkdirSync(path.join(fixtureRoot, 'metadata'));
    fs.writeFileSync(path.join(fixtureRoot, 'metadata', 'widget.js'), 'export class FixtureWidget {}');
    fs.writeFileSync(path.join(fixtureRoot, 'metadata', 'custom-elements.json'), JSON.stringify({
      schemaVersion: '2.1.0',
      modules: [{
        kind: 'javascript-module',
        path: './widget.js',
        declarations: [{
          kind: 'class', name: 'FixtureWidget', customElement: true, tagName: 'fixture-widget',
          attributes: [{ name: 'variant', type: { text: "'small' | 'large'" } }],
          members: [{ kind: 'field', name: 'count', type: { text: 'number' } }],
          events: [{ name: 'select', type: { text: 'CustomEvent<number>' } }],
          slots: [{ name: 'header' }], cssParts: [{ name: 'label' }],
          cssProperties: [{ name: '--fixture-color' }],
        }],
        exports: [],
      }],
    }));

    const data = loadCemProjectData(fixtureRoot, defaultConfig);
    const element = data.elements.get('fixture-widget');
    assert.ok(element);
    assert.equal(element.attributes[0].type, "'small' | 'large'");
    assert.equal(element.properties[0].type, 'number');
    assert.equal(element.events[0].type, 'CustomEvent<number>');
    assert.equal(element.events[0].analysisType, 'any');
    assert.equal(element.slots[0].name, 'header');
    assert.equal(element.cssParts[0].name, 'label');
    assert.equal(element.cssProperties[0].name, '--fixture-color');
    assert.equal(data.htmlData[0].tags?.[0].name, 'fixture-widget');
  });

  it('preserves valid complex display types while restricting diagnostic types', () => {
    fs.writeFileSync(path.join(fixtureRoot, 'metadata', 'custom-elements.json'), JSON.stringify({
      schemaVersion: '2.1.0',
      modules: [{
        kind: 'javascript-module', path: './widget.js',
        declarations: [{
          kind: 'class', name: 'FixtureWidget', customElement: true, tagName: 'typed-widget',
          members: [
            { kind: 'field', name: 'primitive', type: { text: 'string | number[]' } },
            { kind: 'field', name: 'object', type: { text: '{ id: number; label?: string }' } },
            { kind: 'field', name: 'tuple', type: { text: 'readonly [string, number]' } },
            { kind: 'field', name: 'generic', type: { text: 'Map<string, { id: number }>' } },
            { kind: 'field', name: 'intersection', type: { text: '{ id: number } & { name: string }' } },
            { kind: 'field', name: 'callback', type: { text: '(value: number) => void' } },
            { kind: 'field', name: 'invalid', type: { text: '{ broken:' } },
          ],
        }],
        exports: [],
      }],
    }));
    const element = loadCemProjectData(fixtureRoot, defaultConfig).elements.get('typed-widget');
    assert.ok(element);
    assert.equal(element.properties.find(item => item.name === 'primitive')?.analysisType, 'string | number[]');
    assert.match(element.properties.find(item => item.name === 'object')?.type ?? '', /id: number/);
    assert.equal(element.properties.find(item => item.name === 'object')?.analysisType, 'any');
    assert.match(element.properties.find(item => item.name === 'tuple')?.type ?? '', /readonly \[string, number\]/);
    assert.match(element.properties.find(item => item.name === 'generic')?.type ?? '', /Map<string/);
    assert.match(element.properties.find(item => item.name === 'intersection')?.type ?? '', /&/);
    assert.match(element.properties.find(item => item.name === 'callback')?.type ?? '', /=> void/);
    assert.equal(element.properties.find(item => item.name === 'invalid')?.type, 'any');
  });
});
