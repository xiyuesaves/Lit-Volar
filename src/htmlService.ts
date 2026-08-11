import type { CompletionItem, LanguageServicePlugin, TextDocument } from '@volar/language-service';
import type { BindingMetadata, DomHtmlDataProvider } from './bindingRegistry';
import type { LitVolarConfig } from './config';
import type { CemProjectData } from './cemData';

export function withLitDomBindings(
  service: LanguageServicePlugin,
  data: DomHtmlDataProvider,
  config: LitVolarConfig,
  getCemData: () => CemProjectData,
): LanguageServicePlugin {
  return {
    ...service,
    capabilities: {
      ...service.capabilities,
      // Embedded HTML highlights are advertised for the whole host document by LSP.
      // That masks VS Code's TypeScript document highlights outside Lit templates.
      documentHighlightProvider: undefined,
      completionProvider: {
        ...service.capabilities.completionProvider,
        triggerCharacters: [
          ...new Set([
            ...service.capabilities.completionProvider?.triggerCharacters ?? [],
            '.',
            '?',
            '@',
          ]),
        ],
      },
    },
    create(context) {
      const instance = service.create(context);
      const provideCompletionItems = instance.provideCompletionItems?.bind(instance);
      const provideAutoInsertSnippet = instance.provideAutoInsertSnippet?.bind(instance);
      return {
        ...instance,
        async provideCompletionItems(document, position, completionContext, token) {
          const completionList = await provideCompletionItems?.(document, position, completionContext, token);
          const litItems = [
            ...domBindingCompletions(document, position, data, config, getCemData()),
            ...cemTagCompletions(document, position, getCemData()),
          ];
          if (!completionList) return litItems.length > 0 ? { isIncomplete: false, items: litItems } : undefined;
          const litLabels = new Set(litItems.map(item => item.label));
          return {
            ...completionList,
            items: [
              ...litItems,
              ...completionList.items.filter(item => !litLabels.has(item.label)),
            ],
          };
        },
        async provideAutoInsertSnippet(document, position, lastChange, token) {
          const binding = domBindingAtOffset(document.getText(), document.offsetAt(position));
          if (binding && allBindings(binding.tagName, data, config, getCemData()).some(item =>
            item.modifier === binding.modifier && item.name === binding.name)) return '\\${$0}';
          return provideAutoInsertSnippet?.(document, position, lastChange, token);
        },
      };
    },
  };
}

function domBindingCompletions(
  document: TextDocument,
  position: { line: number; character: number },
  data: DomHtmlDataProvider,
  config: LitVolarConfig,
  cemData: CemProjectData,
): CompletionItem[] {
  const offset = document.offsetAt(position);
  const match = /<([\w.-]+)\b([^<>]*)$/.exec(document.getText().slice(0, offset));
  if (!match) return [];
  const partial = /(?:^|\s)([.?@][\w-]*)$/.exec(match[2])?.[1];
  if (!partial) return [];
  const modifier = partial[0] as '.' | '?' | '@';
  const range = { start: document.positionAt(offset - partial.length), end: position };
  return allBindings(match[1], data, config, cemData)
    .filter(binding => binding.modifier === modifier && `${modifier}${binding.name}`.startsWith(partial))
    .map(binding => {
      const label = `${modifier}${binding.name}`;
      return {
        label,
        kind: modifier === '@' ? 23 : 10,
        detail: binding.type,
        documentation: binding.description
          ? { kind: 'markdown' as const, value: binding.description }
          : undefined,
        textEdit: { range, newText: label + '=\\${$0}' },
        insertTextFormat: 2,
      };
    });
}

function allBindings(
  tagName: string,
  data: DomHtmlDataProvider,
  config: LitVolarConfig,
  cemData: CemProjectData,
): BindingMetadata[] {
  const element = cemData.elements.get(tagName);
  const propertyNames = new Set(element?.properties.map(feature => feature.name) ?? []);
  return [
    ...data.getLitBindings(tagName),
    ...element?.attributes
      .filter(feature => !propertyNames.has(feature.name))
      .map(feature => ({ ...feature, modifier: '' as const, source: 'cem' as const })) ?? [],
    ...element?.attributes
      .filter(feature => feature.analysisType === 'boolean')
      .map(feature => ({ ...feature, modifier: '?' as const, source: 'cem' as const })) ?? [],
    ...element?.properties.map(feature => ({ ...feature, modifier: '.' as const, source: 'cem' as const })) ?? [],
    ...element?.events.map(feature => ({ ...feature, modifier: '@' as const, source: 'cem' as const })) ?? [],
    ...config.globalEvents.map(name => ({ name, modifier: '@' as const, source: 'custom-data' as const })),
    ...config.globalAttributes.flatMap(value => {
      const modifier = /^[.?@]/.test(value) ? value[0] as '.' | '?' | '@' : '' as const;
      return [{ name: modifier ? value.slice(1) : value, modifier, source: 'custom-data' as const }];
    }),
  ];
}

function cemTagCompletions(
  document: TextDocument,
  position: { line: number; character: number },
  data: CemProjectData,
): CompletionItem[] {
  const offset = document.offsetAt(position);
  const partial = /<([\w.-]*)$/.exec(document.getText().slice(0, offset))?.[1];
  if (partial === undefined) return [];
  const range = { start: document.positionAt(offset - partial.length), end: position };
  return [...data.elements.values()]
    .filter(element => element.name.startsWith(partial))
    .map(element => ({
      label: element.name,
      kind: 7,
      detail: element.type,
      documentation: element.description
        ? { kind: 'markdown' as const, value: element.description }
        : undefined,
      textEdit: { range, newText: element.name },
    }));
}

function domBindingAtOffset(
  text: string,
  offset: number,
): { tagName: string; modifier: '.' | '?' | '@'; name: string } | undefined {
  const match = /<([\w.-]+)\b[^<>]*?(?:^|\s)([.?@])([\w-]+)\s*=$/.exec(text.slice(0, offset));
  return match ? { tagName: match[1], modifier: match[2] as '.' | '?' | '@', name: match[3] } : undefined;
}
