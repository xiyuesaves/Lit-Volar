import type {
  CodeInformation,
  CodeMapping,
  IScriptSnapshot,
  LanguagePlugin,
  VirtualCode,
} from '@volar/language-core';
import type {} from '@volar/typescript';
import ts from 'typescript';
import { getLanguageService, TextDocument, type Node as HtmlNode } from 'vscode-html-languageservice';
import type { URI } from 'vscode-uri';
import { normalizeConfig, type LitVolarConfig } from './config';

const codeInformation: CodeInformation = {
  completion: true,
  format: true,
  navigation: true,
  semantic: true,
  structure: true,
  verification: true,
};

const htmlLanguageService = getLanguageService();
const supportedLanguageIds = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

type TemplateLanguage = 'html' | 'css' | 'svg';

export class LitRootVirtualCode implements VirtualCode {
  readonly id = 'root';
  readonly mappings: CodeMapping[];
  readonly embeddedCodes: VirtualCode[];

  constructor(
    readonly languageId: string,
    readonly snapshot: IScriptSnapshot,
    config: LitVolarConfig,
  ) {
    const sourceText = snapshot.getText(0, snapshot.getLength());
    this.mappings = [createMapping(0, 0, sourceText.length)];
    this.embeddedCodes = createTemplateCodes(sourceText, languageId, config);
  }
}

export function createLitLanguagePlugin(
  userConfig?: Partial<LitVolarConfig>,
): LanguagePlugin<URI, LitRootVirtualCode> {
  const config = normalizeConfig(userConfig);

  return {
    getLanguageId(uri) {
      return languageIdFromPath(uri.path);
    },
    createVirtualCode(_uri, languageId, snapshot) {
      if (!supportedLanguageIds.has(languageId)) {
        return undefined;
      }
      return new LitRootVirtualCode(languageId, snapshot, config);
    },
    updateVirtualCode(_uri, _virtualCode, snapshot) {
      return new LitRootVirtualCode(_virtualCode.languageId, snapshot, config);
    },
    typescript: {
      extraFileExtensions: [],
      getServiceScript(root) {
        return {
          code: root,
          extension: extensionForLanguageId(root.languageId) as '.ts' | '.tsx' | '.js' | '.jsx',
          scriptKind: scriptKindForLanguageId(root.languageId),
        };
      },
    },
  };
}

export function languageIdFromPath(path: string): string | undefined {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.tsx')) return 'typescriptreact';
  if (lowerPath.endsWith('.jsx')) return 'javascriptreact';
  if (/\.(?:ts|mts|cts)$/.test(lowerPath)) return 'typescript';
  if (/\.(?:js|mjs|cjs)$/.test(lowerPath)) return 'javascript';
  return undefined;
}

function createTemplateCodes(
  sourceText: string,
  languageId: string,
  config: LitVolarConfig,
): VirtualCode[] {
  const sourceFile = ts.createSourceFile(
    `source.${extensionForLanguageId(languageId)}`,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForLanguageId(languageId),
  );
  const embeddedCodes: VirtualCode[] = [];
  let templateIndex = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const templateLanguage = classifyTag(node.tag, sourceFile, config);
      if (templateLanguage) {
        embeddedCodes.push(createTemplateCode(
          sourceText,
          sourceFile,
          node.template,
          templateLanguage,
          templateIndex++,
        ));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return embeddedCodes;
}

function classifyTag(
  tag: ts.LeftHandSideExpression,
  sourceFile: ts.SourceFile,
  config: LitVolarConfig,
): TemplateLanguage | undefined {
  const fullName = tag.getText(sourceFile).replace(/\s+/g, '');
  const shortName = ts.isPropertyAccessExpression(tag) ? tag.name.text : fullName;
  const matches = (tags: string[]) => tags.includes(fullName) || tags.includes(shortName);

  if (matches(config.cssTemplateTags)) return 'css';
  if (matches(config.svgTemplateTags)) return 'svg';
  if (matches(config.htmlTemplateTags)) return 'html';
  return undefined;
}

function createTemplateCode(
  sourceText: string,
  sourceFile: ts.SourceFile,
  template: ts.TemplateLiteral,
  templateLanguage: TemplateLanguage,
  index: number,
): VirtualCode {
  const pieces: string[] = [];
  const mappings: CodeMapping[] = [];
  let generatedOffset = 0;

  if (templateLanguage === 'svg') {
    pieces.push('<svg>');
    generatedOffset += '<svg>'.length;
  }

  const appendSource = (start: number, end: number): void => {
    if (end <= start) return;
    const text = sourceText.slice(start, end);
    pieces.push(text);
    mappings.push(createMapping(start, generatedOffset, text.length));
    generatedOffset += text.length;
  };
  const appendPlaceholder = (placeholderIndex: number): void => {
    const placeholder = templateLanguage === 'css'
      ? `__lit_expr_${placeholderIndex}__`
      : `lit-expr-${placeholderIndex}`;
    pieces.push(placeholder);
    generatedOffset += placeholder.length;
  };

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    appendSource(template.getStart(sourceFile) + 1, template.getEnd() - 1);
  }
  else {
    appendTemplateToken(template.head, false, appendSource);
    template.templateSpans.forEach((span, spanIndex) => {
      appendPlaceholder(spanIndex);
      appendTemplateToken(span.literal, true, appendSource);
    });
  }

  if (templateLanguage === 'svg') {
    pieces.push('</svg>');
  }

  const text = pieces.join('');
  const languageId = templateLanguage;
  const code: VirtualCode = {
    id: `${templateLanguage}_${index}`,
    languageId,
    snapshot: snapshotFromText(text),
    mappings,
    embeddedCodes: [],
  };

  if (templateLanguage === 'html') {
    code.embeddedCodes = createStyleCodes(text, mappings, index);
  }
  return code;
}

function appendTemplateToken(
  token: ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail,
  startsAfterExpression: boolean,
  appendSource: (start: number, end: number) => void,
): void {
  const start = token.getStart() + 1;
  const end = token.getEnd() - (ts.isTemplateTail(token) ? 1 : 2);
  // Template middle/tail tokens include the closing brace from the preceding expression.
  appendSource(startsAfterExpression ? start : token.getStart() + 1, end);
}

function createStyleCodes(
  htmlText: string,
  htmlMappings: CodeMapping[],
  templateIndex: number,
): VirtualCode[] {
  const document = TextDocument.create(`embedded://lit/${templateIndex}.html`, 'html', 0, htmlText);
  const htmlDocument = htmlLanguageService.parseHTMLDocument(document);
  const styles: HtmlNode[] = [];

  const collect = (node: HtmlNode): void => {
    if (node.tag?.toLowerCase() === 'style') {
      styles.push(node);
    }
    node.children.forEach(collect);
  };
  htmlDocument.roots.forEach(collect);

  return styles.flatMap((style, styleIndex) => {
    if (style.startTagEnd === undefined || style.endTagStart === undefined) {
      return [];
    }
    const text = htmlText.slice(style.startTagEnd, style.endTagStart);
    const mappings = htmlMappings.flatMap(mapping => {
      const mappingStart = mapping.generatedOffsets[0];
      const mappingEnd = mappingStart + mapping.lengths[0];
      const overlapStart = Math.max(style.startTagEnd!, mappingStart);
      const overlapEnd = Math.min(style.endTagStart!, mappingEnd);
      if (overlapEnd <= overlapStart) return [];
      return [createMapping(
        mapping.sourceOffsets[0] + overlapStart - mappingStart,
        overlapStart - style.startTagEnd!,
        overlapEnd - overlapStart,
      )];
    });
    return [{
      id: `style_${templateIndex}_${styleIndex}`,
      languageId: 'css',
      snapshot: snapshotFromText(text),
      mappings,
      embeddedCodes: [],
    } satisfies VirtualCode];
  });
}

function createMapping(sourceOffset: number, generatedOffset: number, length: number): CodeMapping {
  return {
    sourceOffsets: [sourceOffset],
    generatedOffsets: [generatedOffset],
    lengths: [length],
    data: codeInformation,
  };
}

function snapshotFromText(text: string): IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

function extensionForLanguageId(languageId: string): string {
  switch (languageId) {
    case 'typescriptreact': return 'tsx';
    case 'javascriptreact': return 'jsx';
    case 'javascript': return 'js';
    default: return 'ts';
  }
}

function scriptKindForLanguageId(languageId: string): ts.ScriptKind {
  switch (languageId) {
    case 'typescriptreact': return ts.ScriptKind.TSX;
    case 'javascriptreact': return ts.ScriptKind.JSX;
    case 'javascript': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}
