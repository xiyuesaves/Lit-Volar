import type ts from 'typescript';
import type { LitVolarConfig } from './config';

export interface HtmlClassToken {
  name: string;
  start: number;
  end: number;
}

export interface CssClassDefinition {
  fileName: string;
  start: number;
  end: number;
}

interface MappedTemplate {
  text: string;
  mappings: Array<{
    generatedStart: number;
    sourceStart: number;
    length: number;
  }>;
}

export function htmlClassTokenAt(text: string, offset: number): HtmlClassToken | undefined {
  const tagStart = text.lastIndexOf('<', offset);
  if (tagStart < 0 || text.lastIndexOf('>', offset) > tagStart) return undefined;
  const tagEnd = text.indexOf('>', tagStart);
  const end = tagEnd < 0 ? text.length : tagEnd + 1;
  if (offset > end) return undefined;

  const tagText = text.slice(tagStart, end);
  const attributePattern = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of tagText.matchAll(attributePattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    const valueIndex = match[0].lastIndexOf(value);
    const valueStart = tagStart + match.index + valueIndex;
    const valueEnd = valueStart + value.length;
    if (offset < valueStart || offset > valueEnd) continue;
    let start = Math.min(offset, valueEnd);
    let tokenEnd = Math.min(offset, valueEnd);
    while (start > valueStart && !/\s/.test(text[start - 1])) start--;
    while (tokenEnd < valueEnd && !/\s/.test(text[tokenEnd])) tokenEnd++;
    if (tokenEnd <= start) return undefined;
    return { name: text.slice(start, tokenEnd), start, end: tokenEnd };
  }
  return undefined;
}

export function findLitCssClassDefinitions(
  typescript: typeof ts,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  sourceOffset: number,
  className: string,
  config: Pick<LitVolarConfig, 'htmlTemplateTags' | 'cssTemplateTags'>,
): CssClassDefinition[] {
  const htmlTemplate = taggedTemplateAtOffset(
    typescript,
    sourceFile,
    sourceOffset,
    config.htmlTemplateTags,
  );
  if (!htmlTemplate) return [];

  const definitions: CssClassDefinition[] = [];
  definitions.push(...definitionsInInlineStyles(
    typescript,
    sourceFile,
    htmlTemplate.template,
    className,
  ));

  const owner = containingClass(typescript, htmlTemplate);
  if (owner) {
    definitions.push(...definitionsInComponentStyles(
      typescript,
      program,
      owner,
      className,
      config.cssTemplateTags,
    ));
  }

  const seen = new Set<string>();
  return definitions.filter(definition => {
    const key = `${definition.fileName}:${definition.start}:${definition.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function taggedTemplateAtOffset(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  offset: number,
  tags: string[],
): ts.TaggedTemplateExpression | undefined {
  let result: ts.TaggedTemplateExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (offset < node.getFullStart() || offset > node.getEnd()) return;
    if (typescript.isTaggedTemplateExpression(node)
      && tagMatches(typescript, node, sourceFile, tags)
      && node.template.getStart(sourceFile) <= offset
      && offset <= node.template.getEnd()) {
      result = node;
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function tagMatches(
  typescript: typeof ts,
  node: ts.TaggedTemplateExpression,
  sourceFile: ts.SourceFile,
  tags: string[],
): boolean {
  const fullName = node.tag.getText(sourceFile).replace(/\s+/g, '');
  const shortName = typescript.isPropertyAccessExpression(node.tag) ? node.tag.name.text : fullName;
  return tags.includes(fullName) || tags.includes(shortName);
}

function containingClass(
  typescript: typeof ts,
  node: ts.Node,
): ts.ClassDeclaration | ts.ClassExpression | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (typescript.isClassDeclaration(current) || typescript.isClassExpression(current)) return current;
  }
  return undefined;
}

function definitionsInComponentStyles(
  typescript: typeof ts,
  program: ts.Program,
  owner: ts.ClassDeclaration | ts.ClassExpression,
  className: string,
  cssTags: string[],
): CssClassDefinition[] {
  const checker = program.getTypeChecker();
  const templates: ts.TaggedTemplateExpression[] = [];
  const seenClasses = new Set<ts.ClassDeclaration | ts.ClassExpression>();
  const seenExpressions = new Set<ts.Node>();
  const seenTemplates = new Set<ts.TaggedTemplateExpression>();

  const addTemplate = (node: ts.TaggedTemplateExpression): void => {
    if (seenTemplates.has(node)) return;
    seenTemplates.add(node);
    templates.push(node);
  };

  const collectExpression = (node: ts.Node | undefined): void => {
    if (!node || seenExpressions.has(node)) return;
    seenExpressions.add(node);
    if (typescript.isTaggedTemplateExpression(node)) {
      if (tagMatches(typescript, node, node.getSourceFile(), cssTags)) addTemplate(node);
      return;
    }
    if (typescript.isIdentifier(node) || typescript.isPropertyAccessExpression(node)) {
      let symbol = checker.getSymbolAtLocation(
        typescript.isPropertyAccessExpression(node) ? node.name : node,
      );
      if (symbol && (symbol.flags & typescript.SymbolFlags.Alias) !== 0) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      for (const declaration of symbol?.declarations ?? []) {
        if (typescript.isVariableDeclaration(declaration)
          || typescript.isPropertyDeclaration(declaration)) {
          collectExpression(declaration.initializer);
        }
        else if (typescript.isGetAccessorDeclaration(declaration)) {
          collectReturnExpressions(typescript, declaration.body, collectExpression);
        }
      }
      return;
    }
    typescript.forEachChild(node, collectExpression);
  };

  const collectClass = (classNode: ts.ClassDeclaration | ts.ClassExpression): void => {
    if (seenClasses.has(classNode)) return;
    seenClasses.add(classNode);
    const styleMembers = classNode.members.filter(member => isStaticStylesMember(typescript, member));
    for (const member of styleMembers) {
      if (typescript.isPropertyDeclaration(member)) collectExpression(member.initializer);
      else if (typescript.isGetAccessorDeclaration(member)) {
        collectReturnExpressions(typescript, member.body, collectExpression);
      }
    }

    // A declared static styles member replaces inherited styles unless its value
    // explicitly references super.styles (resolved above through the checker).
    if (styleMembers.length > 0) return;
    const type = checker.getTypeAtLocation(classNode) as ts.InterfaceType;
    for (const baseType of checker.getBaseTypes(type) ?? []) {
      for (const declaration of baseType.getSymbol()?.declarations ?? []) {
        if ((!typescript.isClassDeclaration(declaration) && !typescript.isClassExpression(declaration))
          || program.isSourceFileFromExternalLibrary(declaration.getSourceFile())) continue;
        collectClass(declaration);
      }
    }
  };

  collectClass(owner);
  return templates.flatMap(template => definitionsInCssTemplate(
    typescript,
    template.getSourceFile(),
    template.template,
    className,
  ));
}

function isStaticStylesMember(typescript: typeof ts, member: ts.ClassElement): boolean {
  if (!member.name
    || (!typescript.isIdentifier(member.name) && !typescript.isStringLiteralLike(member.name))
    || member.name.text !== 'styles') return false;
  return typescript.canHaveModifiers(member)
    && typescript.getModifiers(member)?.some(modifier => modifier.kind === typescript.SyntaxKind.StaticKeyword) === true;
}

function collectReturnExpressions(
  typescript: typeof ts,
  body: ts.Block | undefined,
  collect: (node: ts.Node | undefined) => void,
): void {
  if (!body) return;
  const visit = (node: ts.Node): void => {
    if (typescript.isReturnStatement(node)) collect(node.expression);
    else typescript.forEachChild(node, visit);
  };
  visit(body);
}

function definitionsInCssTemplate(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  template: ts.TemplateLiteral,
  className: string,
): CssClassDefinition[] {
  return definitionsInMappedCss(
    mappedTemplate(typescript, sourceFile, template),
    sourceFile.fileName,
    className,
  );
}

function definitionsInInlineStyles(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  template: ts.TemplateLiteral,
  className: string,
): CssClassDefinition[] {
  const mapped = mappedTemplate(typescript, sourceFile, template);
  const definitions: CssClassDefinition[] = [];
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for (const match of mapped.text.matchAll(stylePattern)) {
    const css = match[1];
    const cssStart = match.index + match[0].indexOf(css);
    definitions.push(...definitionsInMappedCss({
      text: css,
      mappings: mapped.mappings.flatMap(mapping => {
        const overlapStart = Math.max(cssStart, mapping.generatedStart);
        const overlapEnd = Math.min(cssStart + css.length, mapping.generatedStart + mapping.length);
        if (overlapEnd <= overlapStart) return [];
        return [{
          generatedStart: overlapStart - cssStart,
          sourceStart: mapping.sourceStart + overlapStart - mapping.generatedStart,
          length: overlapEnd - overlapStart,
        }];
      }),
    }, sourceFile.fileName, className));
  }
  return definitions;
}

function mappedTemplate(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  template: ts.TemplateLiteral,
): MappedTemplate {
  const pieces: string[] = [];
  const mappings: MappedTemplate['mappings'] = [];
  let generatedOffset = 0;
  const appendSource = (start: number, end: number): void => {
    if (end <= start) return;
    const text = sourceFile.text.slice(start, end);
    pieces.push(text);
    mappings.push({ generatedStart: generatedOffset, sourceStart: start, length: text.length });
    generatedOffset += text.length;
  };
  const appendPlaceholder = (index: number): void => {
    const placeholder = `__lit_expr_${index}__`;
    pieces.push(placeholder);
    generatedOffset += placeholder.length;
  };

  if (typescript.isNoSubstitutionTemplateLiteral(template)) {
    appendSource(template.getStart(sourceFile) + 1, template.getEnd() - 1);
  }
  else {
    appendSource(template.head.getStart(sourceFile) + 1, template.head.getEnd() - 2);
    template.templateSpans.forEach((span, index) => {
      appendPlaceholder(index);
      appendSource(
        span.literal.getStart(sourceFile) + 1,
        span.literal.getEnd() - (typescript.isTemplateTail(span.literal) ? 1 : 2),
      );
    });
  }
  return { text: pieces.join(''), mappings };
}

function definitionsInMappedCss(
  mapped: MappedTemplate,
  fileName: string,
  className: string,
): CssClassDefinition[] {
  return cssClassSelectors(mapped.text)
    .filter(selector => selector.name === className)
    .flatMap(selector => {
      const mapping = mapped.mappings.find(candidate =>
        candidate.generatedStart <= selector.start
        && selector.end <= candidate.generatedStart + candidate.length);
      if (!mapping) return [];
      return [{
        fileName,
        start: mapping.sourceStart + selector.start - mapping.generatedStart,
        end: mapping.sourceStart + selector.end - mapping.generatedStart,
      }];
    });
}

function cssClassSelectors(text: string): Array<{ name: string; start: number; end: number }> {
  const masked = maskCssCommentsAndStrings(text);
  const selectors: Array<{ name: string; start: number; end: number }> = [];
  let segmentStart = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < masked.length; index++) {
    const character = masked[index];
    if (character === '(') parentheses++;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === '[') brackets++;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    if (parentheses > 0 || brackets > 0) continue;
    if (character === ';' || character === '}') {
      segmentStart = index + 1;
      continue;
    }
    if (character !== '{') continue;
    const prelude = masked.slice(segmentStart, index);
    const leadingWhitespace = prelude.search(/\S/);
    if (leadingWhitespace >= 0 && prelude[leadingWhitespace] !== '@') {
      const classPattern = /\.((?:\\(?:[0-9a-fA-F]{1,6}[ \t\r\n\f]?|[^\r\n\f0-9a-fA-F])|[-_a-zA-Z0-9\u0080-\uFFFF])+)/g;
      for (const match of prelude.matchAll(classPattern)) {
        const rawName = match[1];
        if (/^\d/.test(rawName) || /^-\d/.test(rawName)) continue;
        const start = segmentStart + match.index + 1;
        selectors.push({ name: decodeCssIdentifier(rawName), start, end: start + rawName.length });
      }
    }
    segmentStart = index + 1;
  }
  return selectors;
}

function maskCssCommentsAndStrings(text: string): string {
  const result = text.split('');
  let quote: '"' | "'" | undefined;
  let comment = false;
  for (let index = 0; index < text.length; index++) {
    if (comment) {
      if (text[index] === '*' && text[index + 1] === '/') {
        result[index] = ' ';
        result[index + 1] = ' ';
        index++;
        comment = false;
      }
      else if (text[index] !== '\n' && text[index] !== '\r') result[index] = ' ';
      continue;
    }
    if (quote) {
      if (text[index] === '\\') {
        result[index] = ' ';
        if (index + 1 < text.length) result[++index] = ' ';
      }
      else {
        if (text[index] === quote) quote = undefined;
        if (text[index] !== '\n' && text[index] !== '\r') result[index] = ' ';
      }
      continue;
    }
    if (text[index] === '/' && text[index + 1] === '*') {
      result[index] = ' ';
      result[index + 1] = ' ';
      index++;
      comment = true;
    }
    else if (text[index] === '"' || text[index] === "'") {
      quote = text[index] as '"' | "'";
      result[index] = ' ';
    }
  }
  return result.join('');
}

function decodeCssIdentifier(value: string): string {
  return value.replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?|\\([^\r\n\f])/g,
    (_match, hex: string | undefined, escaped: string | undefined) => {
      if (!hex) return escaped ?? '';
      const codePoint = Number.parseInt(hex, 16);
      return codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(codePoint);
    });
}
