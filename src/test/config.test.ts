import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, normalizeConfig } from '../config';

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
});
