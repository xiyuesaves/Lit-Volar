import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, normalizeConfig } from '../config';
import { createAnalyzerRules } from '../litService';

describe('Lit Volar configuration', () => {
  it('uses the low-false-positive profile inputs by default', () => {
    assert.deepEqual(normalizeConfig(), defaultConfig);
  });

  it('normalizes paths, tags, depths, and supported rule severities', () => {
    const config = normalizeConfig({
      htmlTemplateTags: [' html ', 'html', 'view'],
      customElementsManifests: [' custom-elements.json ', 'custom-elements.json'],
      maxProjectImportDepth: 2.9,
      rules: {
        'no-unknown-tag-name': 'warning',
        'no-invalid-css': 'error',
      },
    });
    assert.deepEqual(config.htmlTemplateTags, ['html', 'view']);
    assert.deepEqual(config.customElementsManifests, ['custom-elements.json']);
    assert.equal(config.maxProjectImportDepth, 2);
    assert.deepEqual(config.rules, {
      'no-unknown-tag-name': 'warning',
      'no-invalid-css': 'error',
    });
  });

  it('enables high-confidence binding diagnostics without the full strict profile', () => {
    const rules = createAnalyzerRules(normalizeConfig());
    assert.equal(rules['no-incompatible-type-binding'], 'error');
    assert.equal(rules['no-noncallable-event-binding'], 'error');
    assert.equal(rules['no-invalid-boolean-binding'], 'error');
    assert.equal(rules['no-boolean-in-attribute-binding'], 'warning');
    assert.equal(rules['no-missing-import'], 'warning');
    assert.equal(rules['no-unknown-tag-name'], 'warning');
    assert.equal(rules['no-unknown-property'], 'warning');
    assert.equal(rules['no-legacy-attribute'], 'warning');
    assert.equal(rules['no-invalid-css'], 'off');
  });

  it('layers strict rules over defaults before applying explicit overrides', () => {
    const rules = createAnalyzerRules(normalizeConfig({
      strict: true,
      rules: {
        'no-incompatible-type-binding': 'off',
        'no-unknown-property': 'error',
      },
    }));
    assert.equal(rules['no-unclosed-tag'], 'error');
    assert.equal(rules['no-boolean-in-attribute-binding'], 'error');
    assert.equal(rules['no-unknown-tag-name'], 'warning');
    assert.equal(rules['no-legacy-attribute'], 'warning');
    assert.equal(rules['no-incompatible-type-binding'], 'off');
    assert.equal(rules['no-unknown-property'], 'error');
  });
});
