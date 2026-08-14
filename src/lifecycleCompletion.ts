import type {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  TextDocument,
} from '@volar/language-service';
import type ts from 'typescript';

interface LifecycleMethod {
  name: string;
  detail: string;
  litElementOnly?: boolean;
  typescript: string;
  javascript: string;
}

const lifecycleMethods: LifecycleMethod[] = [
  {
    name: 'connectedCallback',
    detail: 'Called when the element is connected to the document.',
    typescript: 'override connectedCallback(): void {\n\tsuper.connectedCallback();\n\t$0\n}',
    javascript: 'connectedCallback() {\n\tsuper.connectedCallback();\n\t$0\n}',
  },
  {
    name: 'disconnectedCallback',
    detail: 'Called when the element is disconnected from the document.',
    typescript: 'override disconnectedCallback(): void {\n\tsuper.disconnectedCallback();\n\t$0\n}',
    javascript: 'disconnectedCallback() {\n\tsuper.disconnectedCallback();\n\t$0\n}',
  },
  {
    name: 'attributeChangedCallback',
    detail: 'Called when an observed attribute changes.',
    typescript: 'override attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {\n\tsuper.attributeChangedCallback(name, oldValue, value);\n\t$0\n}',
    javascript: 'attributeChangedCallback(name, oldValue, value) {\n\tsuper.attributeChangedCallback(name, oldValue, value);\n\t$0\n}',
  },
  {
    name: 'shouldUpdate',
    detail: 'Determines whether the component should update.',
    typescript: 'protected override shouldUpdate(changedProperties: PropertyValues<this>): boolean {\n\treturn ${1:super.shouldUpdate(changedProperties)};\n}$0',
    javascript: 'shouldUpdate(changedProperties) {\n\treturn ${1:super.shouldUpdate(changedProperties)};\n}$0',
  },
  {
    name: 'willUpdate',
    detail: 'Runs before the component update is performed.',
    typescript: 'protected override willUpdate(changedProperties: PropertyValues<this>): void {\n\tsuper.willUpdate(changedProperties);\n\t$0\n}',
    javascript: 'willUpdate(changedProperties) {\n\tsuper.willUpdate(changedProperties);\n\t$0\n}',
  },
  {
    name: 'update',
    detail: 'Reflects properties and renders the component update.',
    typescript: 'protected override update(changedProperties: PropertyValues<this>): void {\n\tsuper.update(changedProperties);\n\t$0\n}',
    javascript: 'update(changedProperties) {\n\tsuper.update(changedProperties);\n\t$0\n}',
  },
  {
    name: 'firstUpdated',
    detail: 'Runs after the component is updated for the first time.',
    typescript: 'protected override firstUpdated(changedProperties: PropertyValues<this>): void {\n\tsuper.firstUpdated(changedProperties);\n\t$0\n}',
    javascript: 'firstUpdated(changedProperties) {\n\tsuper.firstUpdated(changedProperties);\n\t$0\n}',
  },
  {
    name: 'updated',
    detail: 'Runs after the component update is complete.',
    typescript: 'protected override updated(changedProperties: PropertyValues<this>): void {\n\tsuper.updated(changedProperties);\n\t$0\n}',
    javascript: 'updated(changedProperties) {\n\tsuper.updated(changedProperties);\n\t$0\n}',
  },
  {
    name: 'render',
    detail: 'Returns the template rendered by the component.',
    litElementOnly: true,
    typescript: 'protected override render() {\n\treturn ${1:super.render()};\n}$0',
    javascript: 'render() {\n\treturn ${1:super.render()};\n}$0',
  },
];

export function litLifecycleCompletions(
  typescript: typeof ts,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  offset: number,
  document: TextDocument,
): CompletionItem[] | undefined {
  const classNode = classAtOffset(typescript, sourceFile, offset);
  if (!classNode || !isDirectClassMemberPosition(typescript, classNode, sourceFile, offset)) return undefined;
  const inheritance = litInheritance(program.getTypeChecker(), classNode);
  if (!inheritance.reactiveElement) return undefined;

  const wordStart = identifierStart(sourceFile.text, offset);
  const prefix = sourceFile.text.slice(wordStart, offset);
  const activeMember = classNode.members.find(member => member.getStart(sourceFile) <= wordStart && offset <= member.end);
  const existing = new Set(classNode.members
    .filter(member => member !== activeMember)
    .map(member => memberName(typescript, member))
    .filter((name): name is string => name !== undefined));
  const isTypeScript = !/\.(?:[cm]?js|jsx)$/i.test(sourceFile.fileName);
  const propertyValuesModule = inheritance.litElement ? 'lit' : '@lit/reactive-element';
  const propertyValues = propertyValuesReference(typescript, sourceFile, document, propertyValuesModule);

  return lifecycleMethods
    .filter(method => (!method.litElementOnly || inheritance.litElement)
      && !existing.has(method.name)
      && method.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map(method => {
      const needsPropertyValues = isTypeScript && method.typescript.includes('PropertyValues');
      return {
        label: method.name,
        kind: 2 as CompletionItemKind,
        detail: `Lit lifecycle method - ${method.detail}`,
        documentation: method.detail,
        filterText: method.name,
        sortText: `0_lit_${method.name}`,
        insertTextFormat: 2 as InsertTextFormat,
        textEdit: {
          range: {
            start: document.positionAt(wordStart),
            end: document.positionAt(offset),
          },
          newText: isTypeScript
            ? method.typescript.replaceAll('PropertyValues', propertyValues.typeName)
            : method.javascript,
        },
        additionalTextEdits: needsPropertyValues && propertyValues.importEdit
          ? [propertyValues.importEdit]
          : undefined,
      };
    });
}

function propertyValuesReference(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  document: TextDocument,
  preferredModule: 'lit' | '@lit/reactive-element',
): {
  typeName: string;
  importEdit?: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string };
} {
  const supportedModules = new Set(['lit', 'lit-element', '@lit/reactive-element']);
  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement)
      || !typescript.isStringLiteral(statement.moduleSpecifier)
      || !supportedModules.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (typescript.isNamespaceImport(bindings)) {
      return { typeName: `${bindings.name.text}.PropertyValues` };
    }
    const propertyValues = bindings.elements.find(element =>
      (element.propertyName?.text ?? element.name.text) === 'PropertyValues');
    if (propertyValues) return { typeName: propertyValues.name.text };
  }

  const newline = sourceFile.text.includes('\r\n') ? '\r\n' : '\n';
  const importOffset = sourceFile.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const position = document.positionAt(importOffset);
  return {
    typeName: 'PropertyValues',
    importEdit: {
      range: { start: position, end: position },
      newText: `import type { PropertyValues } from '${preferredModule}';${newline}`,
    },
  };
}

function classAtOffset(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  offset: number,
): ts.ClassDeclaration | ts.ClassExpression | undefined {
  let result: ts.ClassDeclaration | ts.ClassExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (offset < node.getFullStart() || offset > node.end) return;
    if (typescript.isClassDeclaration(node) || typescript.isClassExpression(node)) result = node;
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function isDirectClassMemberPosition(
  typescript: typeof ts,
  classNode: ts.ClassDeclaration | ts.ClassExpression,
  sourceFile: ts.SourceFile,
  offset: number,
): boolean {
  if (offset < classNode.members.pos || offset >= classNode.end) return false;
  const member = classNode.members.find(item => item.getStart(sourceFile) <= offset && offset <= item.end);
  if (!member) return true;
  if (!typescript.isPropertyDeclaration(member) || !member.name || !typescript.isIdentifier(member.name)) return false;
  const start = member.getStart(sourceFile);
  return start <= offset && offset <= member.name.end
    && /^[A-Za-z_$][\w$]*$/.test(sourceFile.text.slice(start, offset).trim());
}

function litInheritance(
  checker: ts.TypeChecker,
  classNode: ts.ClassDeclaration | ts.ClassExpression,
): { reactiveElement: boolean; litElement: boolean } {
  const queue = [...(checker.getTypeAtLocation(classNode).getBaseTypes() ?? [])];
  const seen = new Set<ts.Type>();
  let reactiveElement = false;
  let litElement = false;
  while (queue.length > 0) {
    const type = queue.shift()!;
    if (seen.has(type)) continue;
    seen.add(type);
    const name = type.getSymbol()?.getName();
    if (name === 'LitElement') litElement = true;
    if (name === 'ReactiveElement' || name === 'LitElement') reactiveElement = true;
    queue.push(...(type.getBaseTypes() ?? []));
  }
  return { reactiveElement, litElement };
}

function memberName(typescript: typeof ts, member: ts.ClassElement): string | undefined {
  const name = member.name;
  if (!name) return undefined;
  if (typescript.isIdentifier(name) || typescript.isStringLiteralLike(name) || typescript.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function identifierStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  return start;
}
