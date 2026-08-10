import type { LanguageServicePlugin } from '@volar/language-service';
import type { LitVolarConfig } from './config';

export function wrapCssService(
  service: LanguageServicePlugin,
  config: LitVolarConfig,
): LanguageServicePlugin {
  return {
    ...service,
    create(context) {
      const instance = service.create(context);
      const provideDiagnostics = instance.provideDiagnostics?.bind(instance);
      if (!provideDiagnostics) return instance;
      return {
        ...instance,
        async provideDiagnostics(document, token) {
          if (config.disable || cssRuleSeverity(config) === 'off') return [];
          const diagnostics = await provideDiagnostics(document, token) ?? [];
          const severity = cssRuleSeverity(config) === 'error'
            ? 1
            : 2;
          return diagnostics.map(diagnostic => ({
            ...diagnostic,
            source: 'lit-volar',
            code: 'no-invalid-css',
            severity,
          }));
        },
      };
    },
  };
}

function cssRuleSeverity(config: LitVolarConfig): 'off' | 'warning' | 'error' {
  return config.rules['no-invalid-css'] ?? (config.strict ? 'error' : 'warning');
}
