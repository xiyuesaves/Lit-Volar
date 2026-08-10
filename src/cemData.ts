import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
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
): CemProjectData {
  const manifestFiles = discoverManifestFiles(projectRoot, config.customElementsManifests, program);
  const elements = new Map<string, CemElement>();

  for (const manifestFile of manifestFiles) {
    const manifest = readManifest(manifestFile);
    if (!manifest) continue;
    mergeManifest(elements, manifest, manifestFile);
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
    const packageRoots = new Set<string>();
    for (const sourceFile of program.getSourceFiles()) {
      const packageRoot = packageRootFromNodeModules(sourceFile.fileName);
      if (packageRoot) packageRoots.add(packageRoot);
    }
    for (const packageRoot of packageRoots) {
      addPackageManifest(files, path.join(packageRoot, 'package.json'));
    }
  }
  return [...files];
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
    const value = JSON.parse(fs.readFileSync(fileName, 'utf8')) as CustomElementsManifest;
    return Array.isArray(value.modules) ? value : undefined;
  }
  catch {
    return undefined;
  }
}

function mergeManifest(
  target: Map<string, CemElement>,
  manifest: CustomElementsManifest,
  manifestFile: string,
): void {
  for (const module of manifest.modules) {
    const declarations = new Map(
      (module.declarations ?? [])
        .filter((declaration): declaration is CustomElementDeclaration =>
          declaration.kind === 'class' && 'customElement' in declaration && declaration.customElement === true)
        .map(declaration => [declaration.name, declaration]),
    );
    for (const declaration of declarations.values()) {
      if (declaration.tagName) mergeElement(target, declaration.tagName, declaration, module, manifestFile);
    }
    for (const exported of module.exports ?? []) {
      if (exported.kind !== 'custom-element-definition') continue;
      const declaration = declarations.get(exported.declaration.name);
      if (declaration) mergeElement(target, exported.name, declaration, module, manifestFile);
    }
  }
}

function mergeElement(
  target: Map<string, CemElement>,
  tagName: string,
  declaration: CustomElementDeclaration,
  module: JavaScriptModule,
  manifestFile: string,
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
  mergeFeatures(next.attributes, declaration.attributes?.map(item => feature(item, sourceFile)) ?? []);
  mergeFeatures(
    next.properties,
    (declaration.members ?? [])
      .filter((member): member is ClassField => member.kind === 'field' && member.static !== true)
      .map(item => feature(item, sourceFile)),
  );
  mergeFeatures(next.events, declaration.events?.map(item => feature(item, sourceFile)) ?? []);
  mergeFeatures(next.slots, declaration.slots?.map(item => feature(item, sourceFile)) ?? []);
  mergeFeatures(next.cssParts, declaration.cssParts?.map(item => feature(item, sourceFile)) ?? []);
  mergeFeatures(next.cssProperties, declaration.cssProperties?.map(item => feature(item, sourceFile)) ?? []);
  target.set(tagName, next);
}

function feature(
  item: { name: string; description?: string; summary?: string; type?: { text: string } },
  sourceFile?: string,
): CemFeature {
  return {
    name: item.name,
    description: item.description ?? item.summary,
    type: normalizeCemType(item.type?.text),
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
      existing.sourceFile ??= addition.sourceFile;
    }
  }
}

function normalizeCemType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const type = value.trim();
  if (/^(?:string|number|boolean|any|unknown)$/.test(type)) return type === 'unknown' ? 'any' : type;
  if (/^(?:readonly\s+)?[\w.$<> |'"-]+\[\]$/.test(type)) return type;
  if (/^(?:'[^']*'|"[^"]*")(?:\s*\|\s*(?:'[^']*'|"[^"]*"))*$/.test(type)) return type;
  if (/^Array<[^{}();]+>$/.test(type)) return type;
  return 'any';
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
