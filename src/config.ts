export interface LitVolarConfig {
  htmlTemplateTags: string[];
  cssTemplateTags: string[];
  svgTemplateTags: string[];
}

export const defaultConfig: LitVolarConfig = {
  htmlTemplateTags: ['html', 'raw'],
  cssTemplateTags: ['css'],
  svgTemplateTags: ['svg'],
};

export function normalizeConfig(config?: Partial<LitVolarConfig>): LitVolarConfig {
  return {
    htmlTemplateTags: normalizeTags(config?.htmlTemplateTags, defaultConfig.htmlTemplateTags),
    cssTemplateTags: normalizeTags(config?.cssTemplateTags, defaultConfig.cssTemplateTags),
    svgTemplateTags: normalizeTags(config?.svgTemplateTags, defaultConfig.svgTemplateTags),
  };
}

function normalizeTags(value: string[] | undefined, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return [...new Set(value.map(tag => tag.trim()).filter(Boolean))];
}
