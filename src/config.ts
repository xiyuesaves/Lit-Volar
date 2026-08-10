export const litAnalyzerRuleIds = [
  'no-unknown-tag-name',
  'no-missing-import',
  'no-unclosed-tag',
  'no-unknown-attribute',
  'no-unknown-property',
  'no-unknown-event',
  'no-unknown-slot',
  'no-unintended-mixed-binding',
  'no-invalid-boolean-binding',
  'no-expressionless-property-binding',
  'no-noncallable-event-binding',
  'no-boolean-in-attribute-binding',
  'no-complex-attribute-binding',
  'no-nullable-attribute-binding',
  'no-incompatible-type-binding',
  'no-invalid-directive-binding',
  'no-incompatible-property-type',
  'no-invalid-attribute-name',
  'no-invalid-tag-name',
  'no-invalid-css',
  'no-property-visibility-mismatch',
  'no-legacy-attribute',
  'no-missing-element-type-definition',
] as const;

export type LitVolarRuleId = typeof litAnalyzerRuleIds[number];
export type LitVolarRuleSeverity = 'off' | 'warning' | 'error';
export type LitVolarLogging = 'off' | 'error' | 'warn' | 'debug' | 'verbose';

export interface LitVolarConfig {
  disable: boolean;
  strict: boolean;
  rules: Partial<Record<LitVolarRuleId, LitVolarRuleSeverity>>;
  securitySystem: 'off' | 'ClosureSafeTypes';
  globalTags: string[];
  globalAttributes: string[];
  globalEvents: string[];
  customHtmlData: string[];
  customElementsManifests: string[];
  maxProjectImportDepth: number;
  maxNodeModuleImportDepth: number;
  dontShowSuggestions: boolean;
  logging: LitVolarLogging;
  htmlTemplateTags: string[];
  cssTemplateTags: string[];
  svgTemplateTags: string[];
}

export const defaultConfig: LitVolarConfig = {
  disable: false,
  strict: false,
  rules: {},
  securitySystem: 'off',
  globalTags: [],
  globalAttributes: [],
  globalEvents: [],
  customHtmlData: [],
  customElementsManifests: [],
  maxProjectImportDepth: -1,
  maxNodeModuleImportDepth: 1,
  dontShowSuggestions: false,
  logging: 'off',
  htmlTemplateTags: ['html', 'raw'],
  cssTemplateTags: ['css'],
  svgTemplateTags: ['svg'],
};

export function normalizeConfig(config?: Partial<LitVolarConfig>): LitVolarConfig {
  return {
    disable: config?.disable === true,
    strict: config?.strict === true,
    rules: normalizeRules(config?.rules),
    securitySystem: config?.securitySystem === 'ClosureSafeTypes' ? 'ClosureSafeTypes' : 'off',
    globalTags: normalizeStrings(config?.globalTags, []),
    globalAttributes: normalizeStrings(config?.globalAttributes, []),
    globalEvents: normalizeStrings(config?.globalEvents, []),
    customHtmlData: normalizeStrings(config?.customHtmlData, []),
    customElementsManifests: normalizeStrings(config?.customElementsManifests, []),
    maxProjectImportDepth: normalizeDepth(config?.maxProjectImportDepth, -1),
    maxNodeModuleImportDepth: normalizeDepth(config?.maxNodeModuleImportDepth, 1),
    dontShowSuggestions: config?.dontShowSuggestions === true,
    logging: normalizeLogging(config?.logging),
    htmlTemplateTags: normalizeTags(config?.htmlTemplateTags, defaultConfig.htmlTemplateTags),
    cssTemplateTags: normalizeTags(config?.cssTemplateTags, defaultConfig.cssTemplateTags),
    svgTemplateTags: normalizeTags(config?.svgTemplateTags, defaultConfig.svgTemplateTags),
  };
}

function normalizeTags(value: string[] | undefined, fallback: string[]): string[] {
  return normalizeStrings(value, fallback);
}

function normalizeStrings(value: string[] | undefined, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
}

function normalizeRules(value: LitVolarConfig['rules'] | undefined): LitVolarConfig['rules'] {
  if (!value || typeof value !== 'object') return {};
  const rules: LitVolarConfig['rules'] = {};
  for (const id of litAnalyzerRuleIds) {
    const severity = value[id];
    if (severity === 'off' || severity === 'warning' || severity === 'error') {
      rules[id] = severity;
    }
  }
  return rules;
}

function normalizeDepth(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeLogging(value: LitVolarLogging | undefined): LitVolarLogging {
  return value === 'error' || value === 'warn' || value === 'debug' || value === 'verbose' ? value : 'off';
}
