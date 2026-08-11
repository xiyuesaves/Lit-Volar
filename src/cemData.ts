import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import typescriptRuntime from 'typescript';
import type {
  ClassField,
  CustomElementDeclaration,
  JavaScriptModule,
  Package as CustomElementsManifest,
} from 'custom-elements-manifest' with { "resolution-mode": "import" };
import type ts from 'typescript';
import type { HTMLDataV1, IAttributeData, ITagData } from 'vscode-html-languageservice';
import type { LitVolarConfig } from './config';

export interface CemFeature {
  name: string;
  description?: string;
  type?: string;
  analysisType?: string;
  sourceFile?: string;
}

export interface CemElement extends CemFeature {
  attributes: CemFeature[];
  properties: CemFeature[];
  events: CemFeature[];
  slots: CemFeature[];
  cssParts: CemFeature[];
  cssProperties: CemFeature[];
}

export interface CemProjectData {
  elements: Map<string, CemElement>;
  htmlData: HTMLDataV1[];
  manifestFiles: string[];
}

export function loadCemProjectData(
  projectRoot: string,
  config: LitVolarConfig,
  program?: ts.Program,
  typescript: typeof ts = typescriptRuntime,
): CemProjectData {
  const manifestFiles = discoverManifestFiles(projectRoot, config.customElementsManifests, program);
  const elements = new Map<string, CemElement>();

  for (const manifestFile of manifestFiles) {
    const manifest = readManifest(manifestFile);
    if (!manifest) continue;
    mergeManifest(elements, manifest, manifestFile, typescript);
  }

  const htmlData: HTMLDataV1[] = elements.size > 0
    ? [{ version: 1.1, tags: [...elements.values()].map(toHtmlTagData) }]
    : [];
  return { elements, htmlData, manifestFiles };
}

export function resolveConfigPaths(projectRoot: string, values: string[]): string[] {
  return values.flatMap(value => {
    const matches = fg.sync(value, {
      cwd: projectRoot,
      absolute: true,
      onlyFiles: true,
      unique: true,
      suppressErrors: true,
    });
    return matches.length > 0
      ? matches
      : [path.isAbsolute(value) ? value : path.resolve(projectRoot, value)];
  });
}

function discoverManifestFiles(
  projectRoot: string,
  explicitPatterns: string[],
  program?: ts.Program,
): string[] {
  const packageRoots = new Set<string>();
  if (program) {
    for (const sourceFile of program.getSourceFiles()) {
      const packageRoot = packageRootFromNodeModules(sourceFile.fileName);
      if (packageRoot) packageRoots.add(packageRoot);
    }
  }
  const discoveryKey = [
    path.resolve(projectRoot),
    explicitPatterns.join('\0'),
    fileStatKey(path.join(projectRoot, 'package.json')),
    ...[...packageRoots].sort().map(packageRoot => fileStatKey(path.join(packageRoot, 'package.json'))),
  ].join('|');
  const cached = manifestDiscoveryCache.get(discoveryKey);
  if (cached) return [...cached];

  const files = new Set<string>();
  addIfFile(files, path.join(projectRoot, 'custom-elements.json'));
  addPackageManifest(files, path.join(projectRoot, 'package.json'));

  if (explicitPatterns.length > 0) {
    for (const match of fg.sync(explicitPatterns, {
      cwd: projectRoot,
      absolute: true,
      onlyFiles: true,
      unique: true,
      suppressErrors: true,
    })) {
      addIfFile(files, match);
    }
  }

  if (program) {
    for (const packageRoot of packageRoots) {
      addPackageManifest(files, path.join(packageRoot, 'package.json'));
    }
  }
  const result = [...files];
  manifestDiscoveryCache.set(discoveryKey, result);
  return result;
}

const manifestDiscoveryCache = new Map<string, string[]>();

function fileStatKey(fileName: string): string {
  try {
    const stat = fs.statSync(fileName);
    return `${fileName}:${stat.mtimeMs}:${stat.size}`;
  }
  catch {
    return fileName;
  }
}

function packageRootFromNodeModules(fileName: string): string | undefined {
  const normalized = fileName.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  const rest = normalized.slice(index + marker.length).split('/');
  const packageLength = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length < packageLength) return undefined;
  return normalized.slice(0, index + marker.length) + rest.slice(0, packageLength).join('/');
}

function addPackageManifest(files: Set<string>, packageJsonPath: string): void {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { customElements?: unknown };
    if (typeof packageJson.customElements === 'string') {
      addIfFile(files, path.resolve(path.dirname(packageJsonPath), packageJson.customElements));
    }
  }
  catch {
    // Invalid or absent package metadata should not break editor features.
  }
}

function addIfFile(files: Set<string>, fileName: string): void {
  try {
    if (fs.statSync(fileName).isFile()) files.add(path.resolve(fileName));
  }
  catch {
    // Optional manifests are ignored when absent.
  }
}

function readManifest(fileName: string): CustomElementsManifest | undefined {
  try {
    const stat = fs.statSync(fileName);
    const cached = manifestCache.get(fileName);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const value = JSON.parse(fs.readFileSync(fileName, 'utf8')) as CustomElementsManifest;
    const manifest = Array.isArray(value.modules) ? value : undefined;
    manifestCache.set(fileName, { mtimeMs: stat.mtimeMs, size: stat.size, value: manifest });
    return manifest;
  }
  catch {
    return undefined;
  }
}

const manifestCache = new Map<string, {
  mtimeMs: number;
  size: number;
  value: CustomElementsManifest | undefined;
}>();

function mergeManifest(
  target: Map<string, CemElement>,
  manifest: CustomElementsManifest,
  manifestFile: string,
  typescript: typeof ts,
): void {
  for (const module of manifest.modules) {
    const declarations = new Map(
      (module.declarations ?? [])
        .filter((declaration): declaration is CustomElementDeclaration =>
          declaration.kind === 'class' && 'customElement' in declaration && declaration.customElement === true)
        .map(declaration => [declaration.name, declaration]),
    );
    for (const declaration of declarations.values()) {
      if (declaration.tagName) mergeElement(target, declaration.tagName, declaration, module, manifestFile, typescript);
    }
    for (const exported of module.exports ?? []) {
      if (exported.kind !== 'custom-element-definition') continue;
      const declaration = declarations.get(exported.declaration.name);
      if (declaration) mergeElement(target, exported.name, declaration, module, manifestFile, typescript);
    }
  }
}

function mergeElement(
  target: Map<string, CemElement>,
  tagName: string,
  declaration: CustomElementDeclaration,
  module: JavaScriptModule,
  manifestFile: string,
  typescript: typeof ts,
): void {
  const sourceFile = resolveModuleSource(manifestFile, module.path);
  const existing = target.get(tagName);
  const next: CemElement = existing ?? {
    name: tagName,
    attributes: [],
    properties: [],
    events: [],
    slots: [],
    cssParts: [],
    cssProperties: [],
  };
  next.description ??= declaration.description ?? declaration.summary;
  next.sourceFile ??= sourceFile;
  mergeFeatures(next.attributes, declaration.attributes?.map(item => feature(item, sourceFile, typescript)) ?? []);
  mergeFeatures(
    next.properties,
    (declaration.members ?? [])
      .filter((member): member is ClassField => member.kind === 'field' && member.static !== true)
      .map(item => feature(item, sourceFile, typescript)),
  );
  mergeFeatures(next.events, declaration.events?.map(item => feature(item, sourceFile, typescript)) ?? []);
  mergeFeatures(next.slots, declaration.slots?.map(item => feature(item, sourceFile, typescript)) ?? []);
  mergeFeatures(next.cssParts, declaration.cssParts?.map(item => feature(item, sourceFile, typescript)) ?? []);
  mergeFeatures(next.cssProperties, declaration.cssProperties?.map(item => feature(item, sourceFile, typescript)) ?? []);
  target.set(tagName, next);
}

function feature(
  item: { name: string; description?: string; summary?: string; type?: { text: string } },
  sourceFile?: string,
  typescript: typeof ts = typescriptRuntime,
): CemFeature {
  const normalizedType = normalizeCemType(item.type?.text, typescript);
  return {
    name: item.name,
    description: item.description ?? item.summary,
    type: normalizedType?.display,
    analysisType: normalizedType?.analysis,
    sourceFile,
  };
}

function mergeFeatures(target: CemFeature[], additions: CemFeature[]): void {
  for (const addition of additions) {
    const existing = target.find(item => item.name === addition.name);
    if (!existing) target.push(addition);
    else {
      existing.description ??= addition.description;
      existing.type ??= addition.type;
      existing.analysisType ??= addition.analysisType;
      existing.sourceFile ??= addition.sourceFile;
    }
  }
}

function normalizeCemType(
  value: string | undefined,
  typescript: typeof ts,
): { display: string; analysis: string } | undefined {
  if (!value) return undefined;
  const type = value.trim();
  const source = typescript.createSourceFile(
    'cem-type.ts',
    `type __CemType = ${type};`,
    typescript.ScriptTarget.Latest,
    false,
    typescript.ScriptKind.TS,
  );
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const statement = source.statements[0];
  if (diagnostics.length > 0 || !statement || !typescript.isTypeAliasDeclaration(statement)) {
    return { display: 'any', analysis: 'any' };
  }
  const display = type.replace(/\s+/g, ' ').trim();
  return {
    display,
    analysis: isTrustedCemType(statement.type, typescript) ? display : 'any',
  };
}

function isTrustedCemType(node: ts.TypeNode, typescript: typeof ts): boolean {
  switch (node.kind) {
    case typescript.SyntaxKind.StringKeyword:
    case typescript.SyntaxKind.NumberKeyword:
    case typescript.SyntaxKind.BooleanKeyword:
    case typescript.SyntaxKind.AnyKeyword:
      return true;
  }
  if (typescript.isLiteralTypeNode(node)) return true;
  if (typescript.isParenthesizedTypeNode(node)) return isTrustedCemType(node.type, typescript);
  if (typescript.isUnionTypeNode(node)) return node.types.every(type => isTrustedCemType(type, typescript));
  if (typescript.isArrayTypeNode(node)) return isTrustedCemType(node.elementType, typescript);
  if (typescript.isTypeOperatorNode(node)
    && node.operator === typescript.SyntaxKind.ReadonlyKeyword) return isTrustedCemType(node.type, typescript);
  if (typescript.isTypeReferenceNode(node)
    && typescript.isIdentifier(node.typeName)
    && (node.typeName.text === 'Array' || node.typeName.text === 'ReadonlyArray')
    && node.typeArguments?.length === 1) return isTrustedCemType(node.typeArguments[0], typescript);
  return false;
}

function resolveModuleSource(manifestFile: string, modulePath: string): string | undefined {
  if (!modulePath || /^[a-z]+:/i.test(modulePath)) return undefined;
  let directory = path.dirname(manifestFile);
  while (true) {
    if (fs.existsSync(path.join(directory, 'package.json'))) {
      const packageCandidate = path.resolve(directory, modulePath);
      if (fs.existsSync(packageCandidate)) return packageCandidate;
      break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const manifestCandidate = path.resolve(path.dirname(manifestFile), modulePath);
  return fs.existsSync(manifestCandidate) ? manifestCandidate : undefined;
}

function toHtmlTagData(element: CemElement): ITagData {
  const attributes: IAttributeData[] = [
    ...element.attributes.map(item => ({ name: item.name, description: item.description })),
    ...element.properties.map(item => ({ name: `.${item.name}`, description: item.description })),
    ...element.events.map(item => ({ name: `@${item.name}`, description: item.description })),
  ];
  return { name: element.name, description: element.description, attributes };
}
