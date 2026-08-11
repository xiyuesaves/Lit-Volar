import fs from 'node:fs';
import path from 'node:path';
import type {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  LanguageServicePlugin,
  TextDocument,
} from '@volar/language-service';
import type {} from '@volar/typescript';
import {
  ALL_RULE_IDS,
  DefaultLitAnalyzerContext,
  LitAnalyzer,
  makeConfig,
  type LitAnalyzerConfig,
  type LitAnalyzerRules,
  type LitCodeFix,
  type LitCompletion,
  type LitDefinitionTarget,
} from 'lit-analyzer';
import type ts from 'typescript';
import { URI } from 'vscode-uri';
import type { ComponentDeclaration, ComponentDefinition, ComponentEvent, ComponentMember } from 'web-component-analyzer';
import { loadCemProjectData, resolveConfigPaths, type CemElement, type CemFeature, type CemProjectData } from './cemData';
import type { LitVolarConfig } from './config';
import { typescriptInjectionKeys } from './typescriptBridge';

interface UriConverter {
  asUri(fileName: string): URI;
  asFileName(uri: URI): string;
}

const defaultDiagnosticProfile: LitAnalyzerRules = {
  'no-unclosed-tag': 'warning',
  'no-unintended-mixed-binding': 'warning',
  'no-invalid-boolean-binding': 'error',
  'no-expressionless-property-binding': 'error',
  'no-noncallable-event-binding': 'error',
  'no-boolean-in-attribute-binding': 'warning',
  'no-incompatible-type-binding': 'error',
  'no-invalid-directive-binding': 'error',
  'no-invalid-attribute-name': 'error',
  'no-invalid-tag-name': 'error',
  'no-legacy-attribute': 'warning',
};

export function createLitProjectService(
  typescript: typeof ts,
  config: LitVolarConfig,
): LanguageServicePlugin {
  return {
    name: 'lit-volar-project',
    capabilities: {
      completionProvider: { triggerCharacters: ['<', ' ', '.', '?', '@', '-', '"', "'"] },
      autoInsertionProvider: { triggerCharacters: ['='] },
      hoverProvider: true,
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      codeActionProvider: { codeActionKinds: ['quickfix'] },
      definitionProvider: true,
      renameProvider: { prepareProvider: true },
    },
    create(context) {
      const inject = context.inject as unknown as (key: string) => unknown;
      const languageService = inject(typescriptInjectionKeys.languageService) as ts.LanguageService | undefined;
      const uriConverter = inject(typescriptInjectionKeys.uriConverter) as UriConverter | undefined;
      if (!languageService || !uriConverter) return {};

      let currentToken: { isCancellationRequested: boolean } | undefined;
      let configuredProgram: ts.Program | undefined;
      let cemData: CemProjectData = { elements: new Map(), htmlData: [], manifestFiles: [] };
      const projectRoot = path.dirname(context.project.typescript?.configFileName
        ?? path.join(context.project.typescript?.languageServiceHost.getCurrentDirectory() ?? process.cwd(), 'tsconfig.json'));
      const analyzerContext = new DefaultLitAnalyzerContext({
        ts: typescript,
        getProgram: () => languageService.getProgram()!,
        getProject: () => ({
          getCancellationToken: () => ({
            isCancellationRequested: () => currentToken?.isCancellationRequested === true,
          }),
        }) as never,
      });
      const analyzer = new LitAnalyzer(analyzerContext);

      const prepare = (token: { isCancellationRequested: boolean }): ts.Program | undefined => {
        currentToken = token;
        const program = languageService.getProgram();
        if (!program || config.disable) return undefined;
        if (configuredProgram !== program) {
          configuredProgram = program;
          cemData = loadCemProjectData(projectRoot, config, program);
          analyzerContext.updateConfig(createAnalyzerConfig(config, projectRoot, cemData));
        }
        return program;
      };

      const sourceFileForDocument = (
        document: TextDocument,
        token: { isCancellationRequested: boolean },
      ): {
        file: ts.SourceFile;
        uri: URI;
        sourceOffset(position: { line: number; character: number }): number | undefined;
        documentRange(start: number, end: number): ReturnType<typeof offsetsToRange> | undefined;
      } | undefined => {
        if (!isServiceLanguage(document.languageId)) return undefined;
        const program = prepare(token);
        if (!program) return undefined;
        const parsedUri = URI.parse(document.uri);
        const decoded = context.decodeEmbeddedDocumentUri(parsedUri);
        const sourceUri = decoded?.[0] ?? parsedUri;
        const file = program.getSourceFile(uriConverter.asFileName(sourceUri));
        if (!file) return undefined;
        if (!decoded) {
          return {
            file,
            uri: sourceUri,
            sourceOffset: position => document.offsetAt(position),
            documentRange: (start, end) => offsetsToRange(document, start, end),
          };
        }
        const sourceScript = context.language.scripts.get(sourceUri, true);
        const embeddedCode = sourceScript?.generated?.embeddedCodes.get(decoded[1]);
        if (!sourceScript || !embeddedCode) return undefined;
        const mapper = context.language.maps.get(embeddedCode, sourceScript);
        return {
          file,
          uri: sourceUri,
          sourceOffset(position) {
            return mapper.toSourceLocation(document.offsetAt(position)).next().value?.[0];
          },
          documentRange(start, end) {
            const mapped = mapper.toGeneratedRange(start, end, true).next().value;
            return mapped ? offsetsToRange(document, mapped[0], mapped[1]) : undefined;
          },
        };
      };

      const safely = <T>(fallback: T, operation: () => T): T => {
        try {
          return operation();
        }
        catch (error) {
          if (!(error instanceof typescript.OperationCanceledException)) {
            context.env.console?.error(`[lit-volar] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
          }
          return fallback;
        }
      };

      return {
        isAdditionalCompletion: true,
        provideAutoInsertSnippet(document, position, lastChange, token) {
          if (document.languageId !== 'html'
            || token.isCancellationRequested
            || lastChange.rangeLength !== 0
            || !lastChange.text.endsWith('=')
            || document.offsetAt(position) !== lastChange.rangeOffset + lastChange.text.length) return;
          const documentOffset = document.offsetAt(position);
          const binding = litBindingAtOffset(document.getText(), documentOffset);
          if (!binding) return;
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          const sourceOffset = source.sourceOffset(position);
          if (sourceOffset === undefined) return;
          return safely(undefined, () => {
            // Refresh the analyzer's component store before reading the tag definition.
            analyzer.getQuickInfoAtPosition(source.file, sourceOffset);
            const definition = analyzerContext.definitionStore.getDefinitionForTagName(binding.tagName);
            const cemElement = cemData.elements.get(binding.tagName);
            return isKnownLitBinding(binding, definition, cemElement) ? '\\${$0}' : undefined;
          });
        },

        provideCompletionItems(document, position, _completionContext, token) {
          if (config.dontShowSuggestions) return { isIncomplete: false, items: [] };
          const source = sourceFileForDocument(document, token);
          if (!source || token.isCancellationRequested) return;
          const documentOffset = document.offsetAt(position);
          const offset = source.sourceOffset(position);
          if (offset === undefined) return;
          return safely({ isIncomplete: false, items: [] }, () => {
            const analyzerCompletions = analyzer.getCompletionsAtPosition(source.file, offset) ?? [];
            const tagName = enclosingStartTag(document.getText(), documentOffset);
            const definition = tagName
              ? analyzerContext.definitionStore.getDefinitionForTagName(tagName)
              : undefined;
            const analyzerItems = analyzerCompletions
              .filter(item => item.importance !== 'low' && !isLitPropertyAttributeCompletion(item, definition))
              .map(item => completionFromAnalyzer(document, item, source.documentRange))
              .filter((item): item is CompletionItem => item !== undefined);
            const seen = new Set(analyzerItems.map(completionKey));
            const cemItems = completionsFromCem(document, documentOffset, cemData)
              .filter(item => !seen.has(completionKey(item)));
            return { isIncomplete: false, items: [...analyzerItems, ...cemItems] };
          });
        },

        provideHover(document, position, token) {
          if (document.languageId !== 'html' && document.languageId !== 'css') return;
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          const documentOffset = document.offsetAt(position);
          const offset = source.sourceOffset(position);
          if (offset === undefined) return;
          return safely(undefined, () => {
            const info = analyzer.getQuickInfoAtPosition(source.file, offset);
            const tagToken = customTagTokenAt(document.getText(), documentOffset);
            if (tagToken) {
              const definition = analyzerContext.definitionStore.getDefinitionForTagName(tagToken.text);
              const instanceHover = definition && litInstanceHover(
                document,
                tagToken,
                definition,
                languageService.getProgram(),
                typescript,
              );
              if (instanceHover) return instanceHover;
            }
            if (info) {
              const infoRange = source.documentRange(info.range.start, info.range.end);
              if (infoRange && isCustomContext(
                document.getText(),
                documentOffset,
                document.offsetAt(infoRange.start),
                document.offsetAt(infoRange.end),
              )) {
                return {
                  range: infoRange,
                  contents: {
                    kind: 'markdown' as const,
                    value: [`\`${info.primaryInfo}\``, info.secondaryInfo].filter(Boolean).join('\n\n'),
                  },
                };
              }
            }
            return hoverFromCem(document, documentOffset, cemData);
          });
        },

        provideDiagnostics(document, token) {
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          return safely([], () => analyzer.getDiagnosticsInFile(source.file)
            .filter(diagnostic => diagnostic.source !== 'no-invalid-css')
            .flatMap(diagnostic => {
              const range = source.documentRange(diagnostic.location.start, diagnostic.location.end);
              return range ? [{
              range,
              severity: diagnostic.severity === 'error' ? 1 : 2,
              source: 'lit-volar',
              code: diagnostic.source,
              message: diagnostic.message,
              }] : [];
            }));
        },

        provideCodeActions(document, range, codeActionContext, token) {
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          const start = source.sourceOffset(range.start);
          const end = source.sourceOffset(range.end);
          if (start === undefined || end === undefined) return;
          return safely([], () => analyzer.getCodeFixesAtPositionRange(source.file, { start, end } as never)
            .filter(fix => fix.actions.length > 0)
            .map(fix => codeActionFromFix(document, fix, codeActionContext.diagnostics, source.documentRange)));
        },

        provideDefinition(document, position, token) {
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          const documentOffset = document.offsetAt(position);
          const offset = source.sourceOffset(position);
          if (offset === undefined) return;
          return safely([], () => {
            const definition = analyzer.getDefinitionAtPosition(source.file, offset);
            if (definition) {
              const originSelectionRange = source.documentRange(definition.fromRange.start, definition.fromRange.end);
              return definition.targets.map(target => definitionTargetToLink(target, originSelectionRange, uriConverter));
            }
            const cemDefinition = definitionFromCem(document, documentOffset, cemData, uriConverter);
            return cemDefinition ? [cemDefinition] : [];
          });
        },

        provideRenameRange(document, position, token) {
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          return safely(undefined, () => {
            const offset = source.sourceOffset(position);
            if (offset === undefined) return undefined;
            const info = analyzer.getRenameInfoAtPosition(source.file, offset);
            const range = info && source.documentRange(info.range.start, info.range.end);
            return info && range ? {
              range,
              placeholder: info.displayName,
            } : undefined;
          });
        },

        provideRenameEdits(document, position, newName, token) {
          const source = sourceFileForDocument(document, token);
          if (!source) return;
          return safely(undefined, () => {
            const offset = source.sourceOffset(position);
            if (offset === undefined) return undefined;
            const renameInfo = analyzer.getRenameInfoAtPosition(source.file, offset);
            if (!renameInfo) return undefined;
            const locations = [
              ...analyzer.getRenameLocationsAtPosition(source.file, offset),
              ...registrationRenameLocations(languageService.getProgram(), typescript, renameInfo.displayName),
            ];
            const changes: Record<string, { range: ReturnType<typeof sourceFileRange>; newText: string }[]> = {};
            const seen = new Set<string>();
            for (const location of locations) {
              if (isProtectedRenameTarget(location.fileName)) continue;
              const targetFile = languageService.getProgram()?.getSourceFile(location.fileName);
              if (!targetFile) continue;
              const uri = uriConverter.asUri(location.fileName).toString();
              const key = `${uri}:${location.range.start}:${location.range.end}`;
              if (seen.has(key)) continue;
              seen.add(key);
              (changes[uri] ??= []).push({
                range: sourceFileRange(targetFile, location.range.start, location.range.end),
                newText: `${'prefixText' in location ? location.prefixText ?? '' : ''}${newName}${'suffixText' in location ? location.suffixText ?? '' : ''}`,
              });
            }
            return Object.keys(changes).length > 0 ? { changes } : undefined;
          });
        },
      };
    },
  };
}

function createAnalyzerConfig(config: LitVolarConfig, projectRoot: string, cemData: CemProjectData): LitAnalyzerConfig {
  return makeConfig({
    disable: config.disable,
    strict: config.strict,
    rules: createAnalyzerRules(config),
    securitySystem: config.securitySystem,
    globalTags: config.globalTags,
    globalAttributes: config.globalAttributes,
    globalEvents: config.globalEvents,
    customHtmlData: [
      ...resolveConfigPaths(projectRoot, config.customHtmlData),
      ...cemData.htmlData,
    ],
    maxProjectImportDepth: config.maxProjectImportDepth,
    maxNodeModuleImportDepth: config.maxNodeModuleImportDepth,
    dontShowSuggestions: config.dontShowSuggestions,
    dontSuggestConfigChanges: true,
    logging: config.logging,
    cwd: projectRoot,
    htmlTemplateTags: config.htmlTemplateTags,
    cssTemplateTags: config.cssTemplateTags,
  });
}

export function createAnalyzerRules(
  config: Pick<LitVolarConfig, 'strict' | 'rules'>,
): LitAnalyzerRules {
  const rules = Object.fromEntries(ALL_RULE_IDS.map(id => [id, 'off'])) as LitAnalyzerRules;
  Object.assign(rules, defaultDiagnosticProfile);
  if (config.strict) {
    const strictRules = makeConfig({ strict: true }).rules;
    for (const id of ALL_RULE_IDS) {
      if (ruleSeverityRank(strictRules[id]) > ruleSeverityRank(rules[id])) {
        rules[id] = strictRules[id];
      }
    }
  }
  Object.assign(rules, config.rules);
  // Modern volar-service-css owns CSS parsing and severity mapping.
  rules['no-invalid-css'] = 'off';
  return rules;
}

function ruleSeverityRank(severity: LitAnalyzerRules[keyof LitAnalyzerRules]): number {
  const value = Array.isArray(severity) ? severity[0] : severity;
  if (value === 'error' || value === 2) return 2;
  if (value === 'warn' || value === 'warning' || value === 'on' || value === 1 || value === true) return 1;
  return 0;
}

function completionFromAnalyzer(
  document: TextDocument,
  item: LitCompletion,
  resolveRange: (start: number, end: number) => ReturnType<typeof offsetsToRange> | undefined,
): CompletionItem | undefined {
  const range = item.range
    ? resolveRange(item.range.start, item.range.end)
    : undefined;
  if (item.range && !range) return undefined;
  const documentation = item.documentation?.();
  const insert = withLitBindingValue(item.name, item.insert);
  return {
    label: item.name,
    kind: completionKind(item.kind),
    sortText: item.sortText,
    documentation: documentation ? { kind: 'markdown' as const, value: documentation } : undefined,
    textEdit: range ? { range, newText: insert } : undefined,
    insertText: range ? undefined : insert,
    insertTextFormat: (/\$\d|\$\{\d/.test(insert) ? 2 : 1) as InsertTextFormat,
  };
}

function completionKind(kind: LitCompletion['kind']): CompletionItemKind {
  if (kind.includes('class')) return 7 as CompletionItemKind;
  if (kind.includes('function')) return 2 as CompletionItemKind;
  if (kind.includes('variable') || kind === 'member') return 10 as CompletionItemKind;
  return 12 as CompletionItemKind;
}

function completionKey(item: { label: string; textEdit?: { newText: string }; insertText?: string }): string {
  return `${item.label}\0${item.textEdit?.newText ?? item.insertText ?? ''}`;
}

function completionsFromCem(document: TextDocument, offset: number, data: CemProjectData) {
  const before = document.getText().slice(0, offset);
  const tagMatch = /<([\w.-]*)$/.exec(before);
  if (tagMatch) {
    return [...data.elements.values()]
      .filter(element => element.name.startsWith(tagMatch[1]))
      .map(element => cemCompletion(element, element.name, offset - tagMatch[1].length, offset, document, 7 as CompletionItemKind));
  }

  const partMatch = /::part\(\s*([\w-]*)$/.exec(before);
  if (partMatch) return allFeatures(data, 'cssParts', partMatch[1], document, offset, 12 as CompletionItemKind);
  const propertyMatch = /(?:var\(\s*)?(--[\w-]*)$/.exec(before);
  if (propertyMatch) return allFeatures(data, 'cssProperties', propertyMatch[1], document, offset, 16 as CompletionItemKind);
  const slotMatch = /\bslot\s*=\s*["']([\w-]*)$/.exec(before);
  if (slotMatch) return allFeatures(data, 'slots', slotMatch[1], document, offset, 12 as CompletionItemKind);

  const startTag = /<([\w.-]+)\s+[^<>]*$/.exec(before);
  if (!startTag) return [];
  const element = data.elements.get(startTag[1]);
  if (!element) return [];
  const partial = /([@.?]?[\w-]*)$/.exec(before)?.[1] ?? '';
  const propertyNames = new Set(element.properties.map(property => property.name));
  const features = [
    ...element.attributes.filter(item => !propertyNames.has(item.name)).map(item => [item, item.name] as const),
    ...element.attributes.filter(item => item.type === 'boolean').map(item => [item, `?${item.name}`] as const),
    ...element.properties.map(item => [item, `.${item.name}`] as const),
    ...element.events.map(item => [item, `@${item.name}`] as const),
  ];
  return features
    .filter(([, name]) => name.startsWith(partial))
    .map(([feature, name]) => cemCompletion(feature, name, offset - partial.length, offset, document, 10 as CompletionItemKind));
}

function allFeatures(
  data: CemProjectData,
  key: 'cssParts' | 'cssProperties' | 'slots',
  partial: string,
  document: TextDocument,
  offset: number,
  kind: CompletionItemKind,
) {
  const unique = new Map<string, CemFeature>();
  for (const element of data.elements.values()) {
    for (const feature of element[key]) unique.set(feature.name, feature);
  }
  return [...unique.values()]
    .filter(feature => feature.name.startsWith(partial))
    .map(feature => cemCompletion(feature, feature.name, offset - partial.length, offset, document, kind));
}

function cemCompletion(
  feature: CemFeature,
  label: string,
  start: number,
  end: number,
  document: TextDocument,
  kind: CompletionItemKind,
): CompletionItem {
  const insert = withLitBindingValue(label, label);
  return {
    label,
    kind,
    detail: feature.type,
    documentation: feature.description ? { kind: 'markdown' as const, value: feature.description } : undefined,
    textEdit: { range: offsetsToRange(document, start, end), newText: insert },
    insertTextFormat: (/\$\d|\$\{\d/.test(insert) ? 2 : 1) as InsertTextFormat,
  };
}

function withLitBindingValue(label: string, insert: string): string {
  return /^[.?@]/.test(label) ? insert + '=\\${$0}' : insert;
}

function isLitPropertyAttributeCompletion(
  item: LitCompletion,
  definition: ComponentDefinition | undefined,
): boolean {
  if (/^[.?@]/.test(item.name)) return false;
  return definition?.declaration?.members.some(member =>
    member.kind === 'property'
    && member.attrName === item.name
    && member.visibility !== 'private'
    && member.visibility !== 'protected'
    && (member.meta !== undefined || member.attrName !== undefined)) === true;
}

function hoverFromCem(document: TextDocument, offset: number, data: CemProjectData) {
  const token = tokenAt(document.getText(), offset);
  if (!token) return undefined;
  const element = data.elements.get(token.text);
  if (element) return cemHover(document, token.start, token.end, element.name, element);
  const feature = findCemFeature(document.getText(), offset, token.start, token.text, data);
  return feature ? cemHover(document, token.start, token.end, token.text, feature) : undefined;
}

function litInstanceHover(
  document: TextDocument,
  tagToken: { text: string; start: number; end: number },
  definition: ComponentDefinition,
  program: ts.Program | undefined,
  typescript: typeof ts,
) {
  const declaration = definition.declaration;
  if (!declaration || !program) return undefined;
  const checker = program.getTypeChecker();
  const instanceType = declaration.symbol
    ? checker.getDeclaredTypeOfSymbol(declaration.symbol as unknown as ts.Symbol)
    : checker.getTypeAtLocation(declaration.node as unknown as ts.Node);
  const inheritance = inheritanceChain(instanceType, checker, typescript);
  if (!inheritance.some(name => name === 'LitElement' || name === 'ReactiveElement')) return undefined;

  const properties = declaration.members
    .filter((member): member is ComponentMember & { kind: 'property' } =>
      member.kind === 'property'
      && member.visibility !== 'private'
      && member.visibility !== 'protected'
      && member.node.getSourceFile() === declaration.sourceFile
      && (member.meta !== undefined || member.attrName !== undefined))
    .slice(0, 8);
  const events = declaration.events
    .filter(event => event.visibility !== 'private' && event.visibility !== 'protected')
    .slice(0, 8);
  const lines = [`class ${componentClassName(declaration, tagToken.text, typescript)} {`];
  for (const member of properties) {
    lines.push(`  ${typescriptPropertyName(member.propName)}: ${typeForMember(member, checker, typescript)};`);
  }
  for (const event of events) {
    lines.push(`  ${JSON.stringify(`@${event.name}`)}: ${typeForEvent(event, checker, typescript)};`);
  }
  lines.push('}');
  return {
    range: offsetsToRange(document, tagToken.start, tagToken.end),
    contents: { language: 'typescript', value: lines.join('\n') },
  };
}

function inheritanceChain(type: ts.Type, checker: ts.TypeChecker, typescript: typeof ts): string[] {
  const names: string[] = [];
  let current: ts.Type | undefined = type;
  for (let depth = 0; current && depth < 6; depth++) {
    const name = current.getSymbol()?.getName() ?? checker.typeToString(current);
    if (name && name !== '{}') names.push(name);
    if ((current.flags & typescript.TypeFlags.Object) === 0) break;
    let bases: readonly ts.BaseType[] = [];
    try {
      bases = checker.getBaseTypes(current as ts.InterfaceType) ?? [];
    }
    catch {
      break;
    }
    current = bases[0];
  }
  return names;
}

function typeForMember(member: ComponentMember, checker: ts.TypeChecker, typescript: typeof ts): string {
  try {
    const node = member.node as unknown as ts.Node;
    return checker.typeToString(
      checker.getTypeAtLocation(node),
      node,
      typescript.TypeFormatFlags.NoTruncation,
    );
  }
  catch {
    return member.typeHint ?? 'unknown';
  }
}

function typeForEvent(event: ComponentEvent, checker: ts.TypeChecker, typescript: typeof ts): string {
  if (event.typeHint) return event.typeHint;
  try {
    const eventType = event.type?.() as unknown as ts.Type | undefined;
    if (eventType && typeof eventType.flags === 'number') {
      return checker.typeToString(
        eventType,
        event.node as unknown as ts.Node,
        typescript.TypeFormatFlags.NoTruncation,
      );
    }
  }
  catch {
    // Fall through to the generic event type.
  }
  return 'Event';
}

function componentClassName(
  declaration: ComponentDeclaration,
  tagName: string,
  typescript: typeof ts,
): string {
  const node = declaration.node as unknown as ts.Node;
  if ((typescript.isClassDeclaration(node) || typescript.isClassExpression(node)) && node.name) {
    return node.name.text;
  }
  const symbolName = declaration.symbol?.getName();
  if (symbolName && symbolName !== 'default' && /^[A-Za-z_$][\w$]*$/.test(symbolName)) {
    return symbolName;
  }
  const fallback = tagName
    .split('-')
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z_$][\w$]*$/.test(fallback) ? fallback : 'LitElementComponent';
}

function typescriptPropertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function cemHover(document: TextDocument, start: number, end: number, label: string, feature: CemFeature) {
  return {
    range: offsetsToRange(document, start, end),
    contents: {
      kind: 'markdown' as const,
      value: [`\`${label}${feature.type ? `: ${feature.type}` : ''}\``, feature.description].filter(Boolean).join('\n\n'),
    },
  };
}

function definitionFromCem(document: TextDocument, offset: number, data: CemProjectData, converter: UriConverter) {
  const token = tokenAt(document.getText(), offset);
  if (!token) return undefined;
  let feature: CemFeature | undefined = data.elements.get(token.text);
  feature ??= findCemFeature(document.getText(), offset, token.start, token.text, data);
  if (!feature?.sourceFile || !fs.existsSync(feature.sourceFile)) return undefined;
  return {
    targetUri: converter.asUri(feature.sourceFile).toString(),
    targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    targetSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    originSelectionRange: offsetsToRange(document, token.start, token.end),
  };
}

function findCemFeature(text: string, offset: number, tokenStart: number, token: string, data: CemProjectData): CemFeature | undefined {
  const beforeToken = text.slice(0, tokenStart);
  if (token.startsWith('--')) return findFeatureAcrossElements(data, 'cssProperties', token);
  if (/::part\(\s*$/.test(beforeToken)) return findFeatureAcrossElements(data, 'cssParts', token);
  if (/\bslot\s*=\s*["'][\w-]*$/.test(text.slice(0, offset))) return findFeatureAcrossElements(data, 'slots', token);
  const owner = data.elements.get(enclosingStartTag(text, offset) ?? '');
  if (!owner) return undefined;
  const rawName = token.replace(/^[@.?]/, '');
  return [...owner.attributes, ...owner.properties, ...owner.events].find(item => item.name === rawName);
}

function findFeatureAcrossElements(
  data: CemProjectData,
  key: 'cssProperties' | 'cssParts' | 'slots',
  name: string,
): CemFeature | undefined {
  for (const element of data.elements.values()) {
    const feature = element[key].find(item => item.name === name);
    if (feature) return feature;
  }
  return undefined;
}

function codeActionFromFix(
  document: TextDocument,
  fix: LitCodeFix,
  diagnostics: readonly unknown[],
  resolveRange: (start: number, end: number) => ReturnType<typeof offsetsToRange> | undefined,
) {
  const edits = fix.actions.flatMap(action => {
    const range = resolveRange(action.range.start, action.range.end);
    return range ? [{ range, newText: action.newText }] : [];
  });
  return {
    title: fix.message,
    kind: 'quickfix',
    diagnostics: [...diagnostics] as never[],
    edit: {
      changes: {
        [document.uri]: edits,
      },
    },
  };
}

function definitionTargetToLink(
  target: LitDefinitionTarget,
  originSelectionRange: ReturnType<typeof offsetsToRange> | undefined,
  converter: UriConverter,
) {
  const targetFile = target.kind === 'node' ? target.node.getSourceFile() : target.sourceFile;
  const start = target.kind === 'node' ? target.node.getStart() : target.range.start;
  const end = target.kind === 'node' ? target.node.getEnd() : target.range.end;
  return {
    targetUri: converter.asUri(targetFile.fileName).toString(),
    targetRange: sourceFileRange(targetFile, start, end),
    targetSelectionRange: sourceFileRange(targetFile, start, end),
    originSelectionRange,
  };
}

function sourceFileRange(file: ts.SourceFile, start: number, end: number) {
  const startPosition = file.getLineAndCharacterOfPosition(start);
  const endPosition = file.getLineAndCharacterOfPosition(end);
  return {
    start: { line: startPosition.line, character: startPosition.character },
    end: { line: endPosition.line, character: endPosition.character },
  };
}

function offsetsToRange(document: TextDocument, start: number, end: number) {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

interface LitBinding {
  tagName: string;
  modifier: '.' | '?' | '@';
  name: string;
}

function litBindingAtOffset(text: string, offset: number): LitBinding | undefined {
  const startTag = /<([\w.-]+)\b([^<>]*)$/.exec(text.slice(0, offset));
  if (!startTag) return undefined;
  const attributes = startTag[2];
  const match = /(?:^|\s)([.?@])([\w-]+)\s*=$/.exec(attributes);
  if (!match) return undefined;
  const modifier = match[1] as LitBinding['modifier'];
  const modifierOffset = match.index + match[0].lastIndexOf(modifier);
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < modifierOffset; index++) {
    const character = attributes[index];
    if (quote) {
      if (character === quote) quote = undefined;
    }
    else if (character === '"' || character === "'") {
      quote = character;
    }
  }
  if (quote) return undefined;
  return { tagName: startTag[1], modifier, name: match[2] };
}

function isKnownLitBinding(
  binding: LitBinding,
  definition: ComponentDefinition | undefined,
  cemElement: CemElement | undefined,
): boolean {
  const declaration = definition?.declaration;
  if (binding.modifier === '@') {
    return declaration?.events.some(event =>
      event.name === binding.name
      && event.visibility !== 'private'
      && event.visibility !== 'protected') === true
      || cemElement?.events.some(event => event.name === binding.name) === true;
  }
  if (binding.modifier === '.') {
    return declaration?.members.some(member =>
      member.kind === 'property'
      && member.propName === binding.name
      && member.visibility !== 'private'
      && member.visibility !== 'protected') === true
      || cemElement?.properties.some(property => property.name === binding.name) === true;
  }
  return declaration?.members.some(member =>
    member.kind === 'property'
    && member.attrName === binding.name
    && member.visibility !== 'private'
    && member.visibility !== 'protected') === true
    || cemElement?.attributes.some(attribute => attribute.name === binding.name) === true;
}

function tokenAt(text: string, offset: number): { text: string; start: number; end: number } | undefined {
  let start = offset;
  let end = offset;
  while (start > 0 && /[@.?\w-]/.test(text[start - 1])) start--;
  while (end < text.length && /[@.?\w-]/.test(text[end])) end++;
  return end > start ? { text: text.slice(start, end), start, end } : undefined;
}

function customTagTokenAt(text: string, offset: number): { text: string; start: number; end: number } | undefined {
  const token = tokenAt(text, offset);
  if (!token || !token.text.includes('-')) return undefined;
  const prefix = text.slice(Math.max(0, token.start - 2), token.start);
  return prefix.endsWith('<') || prefix.endsWith('</') ? token : undefined;
}

function enclosingStartTag(text: string, offset: number): string | undefined {
  return /<([\w.-]+)\b[^<>]*$/.exec(text.slice(0, offset))?.[1];
}

function isCustomContext(text: string, offset: number, start: number, end: number): boolean {
  const token = text.slice(start, end);
  return token.includes('-') || /^[@.?]/.test(token) || enclosingStartTag(text, offset)?.includes('-') === true;
}

function isProtectedRenameTarget(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, '/');
  return normalized.includes('/node_modules/') || normalized.endsWith('/custom-elements.json');
}

function registrationRenameLocations(
  program: ts.Program | undefined,
  typescript: typeof ts,
  tagName: string,
): { fileName: string; range: { start: number; end: number } }[] {
  if (!program) return [];
  const locations: { fileName: string; range: { start: number; end: number } }[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (program.isSourceFileFromExternalLibrary(sourceFile)) continue;
    const visit = (node: ts.Node): void => {
      if (typescript.isStringLiteralLike(node) && node.text === tagName && isTagRegistrationString(node, typescript)) {
        locations.push({
          fileName: sourceFile.fileName,
          range: { start: node.getStart(sourceFile) + 1, end: node.getEnd() - 1 },
        });
      }
      typescript.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return locations;
}

function isTagRegistrationString(node: ts.StringLiteralLike, typescript: typeof ts): boolean {
  const parent = node.parent;
  if (typescript.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
    const expression = parent.expression;
    const name = typescript.isIdentifier(expression)
      ? expression.text
      : typescript.isPropertyAccessExpression(expression) ? expression.name.text : '';
    return name === 'customElement' || name === 'define';
  }
  if (typescript.isPropertySignature(parent) && parent.name === node) {
    const declaration = parent.parent;
    return typescript.isInterfaceDeclaration(declaration) && declaration.name.text === 'HTMLElementTagNameMap';
  }
  return false;
}

function isServiceLanguage(languageId: string): boolean {
  return languageId === 'typescript'
    || languageId === 'typescriptreact'
    || languageId === 'javascript'
    || languageId === 'javascriptreact'
    || languageId === 'html'
    || languageId === 'css';
}
