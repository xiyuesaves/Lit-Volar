import type { LanguageServicePlugin } from '@volar/language-service';
import type {} from '@volar/typescript';
import type ts from 'typescript';

export const typescriptInjectionKeys = {
  languageService: 'typescript/languageService',
  languageServiceHost: 'typescript/languageServiceHost',
  uriConverter: 'typescript/uriConverter',
} as const;

export function createTypeScriptBridge(
  typescript: typeof ts,
): LanguageServicePlugin {
  return {
    name: 'lit-volar-typescript-bridge',
    capabilities: {},
    create(context) {
      const project = context.project.typescript;
      if (!project) return {};
      const languageService = typescript.createLanguageService(project.languageServiceHost);
      return {
        provide: {
          [typescriptInjectionKeys.languageService]: () => languageService,
          [typescriptInjectionKeys.languageServiceHost]: () => project.languageServiceHost,
          [typescriptInjectionKeys.uriConverter]: () => project.uriConverter,
        },
        dispose: () => languageService.dispose(),
      };
    },
  };
}
