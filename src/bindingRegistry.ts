import fs from 'node:fs';
import type ts from 'typescript';
import {
  getDefaultHTMLDataProvider,
  newHTMLDataProvider,
  type HTMLDataV1,
  type IHTMLDataProvider,
  type ITagData,
} from 'vscode-html-languageservice';
import type { ComponentDefinition, ComponentMember } from 'web-component-analyzer';
import type { CemElement, CemProjectData } from './cemData';
import { resolveConfigPaths } from './cemData';
import type { LitVolarConfig } from './config';

export type BindingModifier = '' | '.' | '?' | '@';

export interface BindingMetadata {
  name: string;
  modifier: BindingModifier;
  type?: string;
  description?: string;
  source: 'typescript' | 'cem' | 'custom-data' | 'dom';
  inherited?: boolean;
}

interface DomCache {
  signature: string;
  tags: Map<string, BindingMetadata[]>;
}

const htmlDataProvider = getDefaultHTMLDataProvider();

export interface DomHtmlDataProvider extends IHTMLDataProvider {
  getLitBindings(tagName: string): BindingMetadata[];
}

export function createDomHtmlDataProvider(typescript: typeof ts): DomHtmlDataProvider {
  const program = createFallbackDomProgram(typescript);
  const tags: ITagData[] = [];
  const bindingsByTag = new Map<string, BindingMetadata[]>();
  const seen = new Set<string>();
  for (const sourceTag of domTagNames(program, typescript)) {
    if (seen.has(sourceTag)) continue;
    seen.add(sourceTag);
    const bindings = createDomBindings(sourceTag, program, typescript);
    bindingsByTag.set(sourceTag, bindings);
    tags.push({
      name: sourceTag,
      attributes: bindings.map(binding => ({
        name: `${binding.modifier}${binding.name}`,
        description: binding.description,
      })),
    });
  }
  return Object.assign(newHTMLDataProvider('lit-volar-dom', { version: 1.1, tags }), {
    getLitBindings(tagName: string) {
      return bindingsByTag.get(tagName) ?? [];
    },
  });
}

export class BindingRegistry {
  private domCache: DomCache | undefined;
  private readonly componentCache = new WeakMap<object, { signature: string; bindings: BindingMetadata[] }>();
  private readonly customData: HTMLDataV1[];

  constructor(
    private readonly typescript: typeof ts,
    private readonly config: LitVolarConfig,
    projectRoot: string,
  ) {
    this.customData = loadCustomHtmlData(projectRoot, config.customHtmlData);
  }

  getBindings(
    tagName: string,
    program: ts.Program,
    definition: ComponentDefinition | undefined,
    cemData: CemProjectData,
  ): BindingMetadata[] {
    const result = new Map<string, BindingMetadata>();
    const add = (binding: BindingMetadata) => {
      const key = `${binding.modifier}${binding.name}`;
      if (!result.has(key)) result.set(key, binding);
    };

    for (const binding of this.getComponentBindings(definition, program)) add(binding);
    const cemElement = cemData.elements.get(tagName);
    if (cemElement) for (const binding of bindingsFromCem(cemElement)) add(binding);
    for (const binding of bindingsFromCustomData(this.customData, tagName)) add(binding);
    for (const event of this.config.globalEvents) add({ name: event, modifier: '@', source: 'custom-data' });
    for (const attribute of this.config.globalAttributes) {
      const modifier = bindingModifier(attribute);
      add({ name: modifier ? attribute.slice(1) : attribute, modifier, source: 'custom-data' });
    }
    for (const binding of this.getDomBindings(tagName, program)) add(binding);
    return [...result.values()];
  }

  hasBinding(
    tagName: string,
    modifier: Exclude<BindingModifier, ''>,
    name: string,
    program: ts.Program,
    definition: ComponentDefinition | undefined,
    cemData: CemProjectData,
  ): boolean {
    return this.getBindings(tagName, program, definition, cemData)
      .some(binding => binding.modifier === modifier && binding.name === name);
  }

  private getDomBindings(tagName: string, program: ts.Program): BindingMetadata[] {
    const signature = domProgramSignature(program);
    if (this.domCache?.signature !== signature) {
      this.domCache = { signature, tags: new Map() };
    }
    const cached = this.domCache.tags.get(tagName);
    if (cached) return cached;
    const bindings = createDomBindings(tagName, program, this.typescript);
    this.domCache.tags.set(tagName, bindings);
    return bindings;
  }

  private getComponentBindings(
    definition: ComponentDefinition | undefined,
    program: ts.Program,
  ): BindingMetadata[] {
    if (!definition?.declaration) return [];
    const signature = componentDefinitionSignature(definition);
    const cached = this.componentCache.get(definition);
    if (cached?.signature === signature) return cached.bindings;
    const bindings = bindingsFromDefinition(definition, program, this.typescript);
    this.componentCache.set(definition, { signature, bindings });
    return bindings;
  }
}

function componentDefinitionSignature(definition: ComponentDefinition): string {
  const files = new Set([
    definition.declaration?.sourceFile,
    ...definition.declaration?.members.map(member => member.node.getSourceFile()) ?? [],
    ...definition.declaration?.events.map(event => event.node.getSourceFile()) ?? [],
  ].filter(value => value !== undefined));
  return [...files].map(sourceFile => {
    const version = (sourceFile as typeof sourceFile & { version?: string }).version;
    return `${sourceFile.fileName}:${version ?? textHash(sourceFile.text)}`;
  }).sort().join('|');
}

function textHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function bindingsFromDefinition(
  definition: ComponentDefinition | undefined,
  program: ts.Program,
  typescript: typeof ts,
): BindingMetadata[] {
  const declaration = definition?.declaration;
  if (!declaration) return [];
  const checker = program.getTypeChecker();
  const bindings: BindingMetadata[] = [];
  for (const member of declaration.members) {
    if (!isPublicReactiveProperty(member)) continue;
    const memberType = typeForNode(member.node as unknown as ts.Node, checker, typescript, member.typeHint);
    bindings.push({
      name: member.propName,
      modifier: '.',
      type: memberType,
      description: member.jsDoc?.description,
      source: 'typescript',
      inherited: member.node.getSourceFile() !== declaration.sourceFile,
    });
    if (member.attrName && memberType === 'boolean') {
      bindings.push({
        name: member.attrName,
        modifier: '?',
        type: memberType,
        description: member.jsDoc?.description,
        source: 'typescript',
        inherited: member.node.getSourceFile() !== declaration.sourceFile,
      });
    }
  }
  for (const event of declaration.events) {
    if (event.visibility === 'private' || event.visibility === 'protected') continue;
    bindings.push({
      name: event.name,
      modifier: '@',
      type: event.typeHint,
      description: event.jsDoc?.description,
      source: 'typescript',
      inherited: event.node.getSourceFile() !== declaration.sourceFile,
    });
  }
  return bindings;
}

function isPublicReactiveProperty(
  member: ComponentMember,
): member is ComponentMember & { kind: 'property' } {
  return member.kind === 'property'
    && member.visibility !== 'private'
    && member.visibility !== 'protected'
    && (member.meta !== undefined || member.attrName !== undefined);
}

function typeForNode(
  node: ts.Node,
  checker: ts.TypeChecker,
  typescript: typeof ts,
  fallback?: string,
): string | undefined {
  try {
    return checker.typeToString(
      checker.getTypeAtLocation(node),
      node,
      typescript.TypeFormatFlags.NoTruncation,
    );
  }
  catch {
    return fallback;
  }
}

function bindingsFromCem(element: CemElement): BindingMetadata[] {
  const propertyNames = new Set(element.properties.map(feature => feature.name));
  return [
    ...element.attributes
      .filter(feature => !propertyNames.has(feature.name))
      .map(feature => ({ ...cemBinding(feature, ''), modifier: '' as const })),
    ...element.attributes
      .filter(feature => feature.analysisType === 'boolean')
      .map(feature => ({ ...cemBinding(feature, '?'), modifier: '?' as const })),
    ...element.properties.map(feature => ({ ...cemBinding(feature, '.'), modifier: '.' as const })),
    ...element.events.map(feature => ({ ...cemBinding(feature, '@'), modifier: '@' as const })),
  ];
}

function cemBinding(feature: CemElement['properties'][number], modifier: BindingModifier): BindingMetadata {
  return {
    name: feature.name,
    modifier,
    type: feature.type,
    description: feature.description,
    source: 'cem',
  };
}

function bindingsFromCustomData(data: HTMLDataV1[], tagName: string): BindingMetadata[] {
  const attributes = data.flatMap(value => [
    ...value.globalAttributes ?? [],
    ...value.tags?.find(tag => tag.name === tagName)?.attributes ?? [],
  ]);
  return attributes.flatMap(attribute => {
    const modifier = bindingModifier(attribute.name);
    const binding: BindingMetadata = {
      name: modifier ? attribute.name.slice(1) : attribute.name,
      modifier,
      description: typeof attribute.description === 'string' ? attribute.description : undefined,
      source: 'custom-data' as const,
    };
    return attribute.valueSet === 'v' && !modifier
      ? [binding, { ...binding, modifier: '?' as const }]
      : [binding];
  });
}

function bindingModifier(name: string): BindingModifier {
  return name[0] === '.' || name[0] === '?' || name[0] === '@' ? name[0] : '';
}

function loadCustomHtmlData(projectRoot: string, patterns: string[]): HTMLDataV1[] {
  const values: HTMLDataV1[] = [];
  for (const fileName of resolveConfigPaths(projectRoot, patterns)) {
    try {
      const value = JSON.parse(fs.readFileSync(fileName, 'utf8')) as HTMLDataV1;
      if (value.version && (Array.isArray(value.tags) || Array.isArray(value.globalAttributes))) values.push(value);
    }
    catch {
      // Optional custom data is ignored when absent or malformed.
    }
  }
  return values;
}

function domProgramSignature(program: ts.Program): string {
  const options = program.getCompilerOptions();
  const libs = program.getSourceFiles()
    .filter(file => file.hasNoDefaultLib || /(?:^|[/\\])lib\.[\w.-]+\.d\.ts$/i.test(file.fileName))
    .map(file => `${file.fileName}:${file.text.length}`)
    .sort();
  return `${JSON.stringify(options.lib ?? [])}|${libs.join('|')}`;
}

function createDomBindings(tagName: string, program: ts.Program, typescript: typeof ts): BindingMetadata[] {
  const checker = program.getTypeChecker();
  const anchor = program.getSourceFiles().find(file => !file.isDeclarationFile) ?? program.getSourceFiles()[0];
  if (!anchor) return [];
  const mapName = tagName.includes(':') ? 'SVGElementTagNameMap' : undefined;
  const mapSymbols = checker.getSymbolsInScope(anchor, typescript.SymbolFlags.Type);
  const candidates = mapName
    ? [mapName]
    : ['HTMLElementTagNameMap', 'SVGElementTagNameMap'];
  let elementType: ts.Type | undefined;
  for (const candidate of candidates) {
    const mapSymbol = mapSymbols.find(symbol => symbol.getName() === candidate);
    if (!mapSymbol) continue;
    const mapType = checker.getDeclaredTypeOfSymbol(mapSymbol);
    const tagSymbol = checker.getPropertyOfType(mapType, tagName);
    if (!tagSymbol) continue;
    elementType = checker.getTypeOfSymbolAtLocation(tagSymbol, tagSymbol.valueDeclaration ?? tagSymbol.declarations?.[0] ?? anchor);
    break;
  }
  if (!elementType) return [];

  const ownTypeName = elementType.getSymbol()?.getName();
  const properties: BindingMetadata[] = [];
  const events: BindingMetadata[] = [];
  for (const symbol of elementType.getProperties()) {
    const name = symbol.getName();
    const location = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? anchor;
    const type = checker.getTypeOfSymbolAtLocation(symbol, location);
    const inherited = !symbol.declarations?.some(declaration =>
      typescript.isInterfaceDeclaration(declaration.parent)
      && declaration.parent.name.text === ownTypeName);
    const description = typescript.displayPartsToString(symbol.getDocumentationComment(checker));
    if (name.startsWith('on') && name.length > 2) {
      const eventType = eventParameterType(type, checker, typescript);
      if (eventType) {
        events.push({
          name: name.slice(2),
          modifier: '@',
          type: eventType,
          description: description || undefined,
          source: 'dom',
          inherited,
        });
      }
      continue;
    }
    if (!isWritableProperty(symbol, typescript) || type.getCallSignatures().length > 0) continue;
    properties.push({
      name,
      modifier: '.',
      type: checker.typeToString(type, location, typescript.TypeFormatFlags.NoTruncation),
      description: description || undefined,
      source: 'dom',
      inherited,
    });
  }

  const booleans: BindingMetadata[] = htmlDataProvider.provideAttributes(tagName)
    .filter(attribute => attribute.valueSet === 'v')
    .map(attribute => ({
      name: attribute.name,
      modifier: '?',
      description: typeof attribute.description === 'string' ? attribute.description : undefined,
      source: 'dom',
    }));
  const ownFirst = (left: BindingMetadata, right: BindingMetadata) => Number(left.inherited) - Number(right.inherited)
    || left.name.localeCompare(right.name);
  return [...properties.sort(ownFirst), ...events.sort(ownFirst), ...booleans];
}

function domTagNames(program: ts.Program, typescript: typeof ts): string[] {
  const anchor = program.getSourceFiles().find(file => !file.isDeclarationFile) ?? program.getSourceFiles()[0];
  if (!anchor) return [];
  const symbols = checkerSymbols(program, anchor, typescript);
  return ['HTMLElementTagNameMap', 'SVGElementTagNameMap'].flatMap(name => {
    const mapSymbol = symbols.find(symbol => symbol.getName() === name);
    if (!mapSymbol) return [];
    const mapType = program.getTypeChecker().getDeclaredTypeOfSymbol(mapSymbol);
    return program.getTypeChecker().getPropertiesOfType(mapType).map(symbol => symbol.getName());
  });
}

function checkerSymbols(program: ts.Program, anchor: ts.SourceFile, typescript: typeof ts): ts.Symbol[] {
  return program.getTypeChecker().getSymbolsInScope(anchor, typescript.SymbolFlags.Type);
}

function createFallbackDomProgram(typescript: typeof ts): ts.Program {
  const root = typescript.sys.resolvePath('__lit-volar-dom-fallback__.ts');
  const options: ts.CompilerOptions = {
    target: typescript.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true,
  };
  const host = typescript.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = fileName => fileName === root || originalFileExists(fileName);
  host.readFile = fileName => fileName === root ? 'export {};' : originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === root
      ? typescript.createSourceFile(root, 'export {};', languageVersion, true, typescript.ScriptKind.TS)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  return typescript.createProgram([root], options, host);
}

function eventParameterType(type: ts.Type, checker: ts.TypeChecker, typescript: typeof ts): string | undefined {
  const callable = checker.getNonNullableType(type);
  const signature = callable.getCallSignatures()[0];
  const parameter = signature?.getParameters()[0];
  if (!parameter) return undefined;
  const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
  const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration ?? callable.symbol?.valueDeclaration!);
  return checker.typeToString(parameterType, declaration, typescript.TypeFormatFlags.NoTruncation);
}

function isWritableProperty(symbol: ts.Symbol, typescript: typeof ts): boolean {
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return true;
  if (declarations.some(declaration =>
    (typescript.isPropertySignature(declaration) || typescript.isPropertyDeclaration(declaration))
    && declaration.modifiers?.some(modifier => modifier.kind === typescript.SyntaxKind.ReadonlyKeyword))) return false;
  const getters = declarations.filter(typescript.isGetAccessorDeclaration);
  if (getters.length > 0 && !declarations.some(typescript.isSetAccessorDeclaration)) return false;
  return true;
}
