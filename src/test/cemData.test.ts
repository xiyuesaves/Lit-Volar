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
    assert.equal(element.events[0].type, 'any');
    assert.equal(element.slots[0].name, 'header');
    assert.equal(element.cssParts[0].name, 'label');
    assert.equal(element.cssProperties[0].name, '--fixture-color');
    assert.equal(data.htmlData[0].tags?.[0].name, 'fixture-widget');
  });
});
