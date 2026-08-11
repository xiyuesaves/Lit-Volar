import type { CompletionItem, LanguageServicePlugin } from '@volar/language-service';
import type { LitVolarConfig } from './config';
import { defaultLitBooleans, defaultLitEvents, defaultLitProperties } from './litHtmlData';

const litExpressionSnippet = '\\${$0}';

export function wrapHtmlService(
  service: LanguageServicePlugin,
  config: LitVolarConfig,
): LanguageServicePlugin {
  return {
    ...service,
    capabilities: {
      ...service.capabilities,
      completionProvider: {
        ...service.capabilities.completionProvider,
        triggerCharacters: [
          ...new Set([
            ...service.capabilities.completionProvider?.triggerCharacters ?? [],
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
          if (!completionList) return completionList;
          return {
            ...completionList,
            items: completionList.items.map(item => litBindingCompletion(item, config)),
          };
        },
        async provideAutoInsertSnippet(document, position, lastChange, token) {
          const snippet = await provideAutoInsertSnippet?.(document, position, lastChange, token);
          if (!snippet) return snippet;
          const binding = /([.?@][\w-]+)\s*=$/.exec(document.getText().slice(0, document.offsetAt(position)))?.[1];
          return binding && isDefaultLitBinding(binding, config) ? litExpressionSnippet : snippet;
        },
      };
    },
  };
}

function litBindingCompletion(item: CompletionItem, config: LitVolarConfig): CompletionItem {
  if (!isDefaultLitBinding(item.label, config)) return item;
  const insert = `${item.label}=${litExpressionSnippet}`;
  return {
    ...item,
    insertText: item.textEdit ? item.insertText : insert,
    textEdit: item.textEdit ? { ...item.textEdit, newText: insert } : item.textEdit,
    insertTextFormat: 2,
  };
}

function isDefaultLitBinding(label: string, config: LitVolarConfig): boolean {
  const modifier = label[0];
  const name = label.slice(1);
  if (modifier === '@') return defaultLitEvents.includes(name) || config.globalEvents.includes(name);
  if (modifier === '.') return defaultLitProperties.includes(name);
  if (modifier === '?') return defaultLitBooleans.includes(name);
  return false;
}
