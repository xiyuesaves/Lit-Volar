import { activateAutoInsertion, createLabsInfo, getTsdk } from '@volar/vscode';
import {
  LanguageClient,
  TransportKind,
  type BaseLanguageClient,
  type DocumentSelector,
  type LanguageClientOptions,
  type ServerOptions,
} from '@volar/vscode/node';
import * as vscode from 'vscode';
import type { LitVolarConfig } from './config';

let client: BaseLanguageClient | undefined;
let autoInsertion: vscode.Disposable | undefined;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let restarting: Promise<void> | undefined;
let labsInfo: ReturnType<typeof createLabsInfo> | undefined;

const documentSelector: DocumentSelector = [
  ...['file', 'untitled'].flatMap(scheme => [
    { scheme, language: 'javascript' },
    { scheme, language: 'javascriptreact' },
    { scheme, language: 'typescript' },
    { scheme, language: 'typescriptreact' },
  ]),
];

export async function activate(context: vscode.ExtensionContext) {
  labsInfo = createLabsInfo();
  await startClient(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('litVolar')) scheduleRestart(context);
    }),
  );
  const metadataWatcher = vscode.workspace.createFileSystemWatcher('**/*.json');
  context.subscriptions.push(
    metadataWatcher,
    metadataWatcher.onDidCreate(() => scheduleRestart(context)),
    metadataWatcher.onDidChange(() => scheduleRestart(context)),
    metadataWatcher.onDidDelete(() => scheduleRestart(context)),
  );

  return labsInfo.extensionExports;
}

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = vscode.Uri.joinPath(context.extensionUri, 'dist', 'server.js').fsPath;
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6011'] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    initializationOptions: {
      litVolar: readConfig(),
      typescript: { tsdk: (await getTsdk(context))?.tsdk },
    },
  };

  client = new LanguageClient(
    'lit-volar-language-server',
    'Lit Volar Language Server',
    serverOptions,
    clientOptions,
  );
  await client.start();
  labsInfo?.addLanguageClient(client);
  autoInsertion?.dispose();
  autoInsertion = activateAutoInsertion(documentSelector, client);
}

export function deactivate(): Thenable<void> | undefined {
  autoInsertion?.dispose();
  return client?.stop();
}

function scheduleRestart(context: vscode.ExtensionContext): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restarting ??= restartClient(context).finally(() => {
      restarting = undefined;
    });
  }, 250);
}

async function restartClient(context: vscode.ExtensionContext): Promise<void> {
  autoInsertion?.dispose();
  autoInsertion = undefined;
  await client?.stop();
  client = undefined;
  await startClient(context);
}

function readConfig(): LitVolarConfig {
  const config = vscode.workspace.getConfiguration('litVolar');
  return {
    disable: config.get<boolean>('disable', false),
    strict: config.get<boolean>('strict', false),
    rules: config.get<LitVolarConfig['rules']>('rules', {}),
    securitySystem: config.get<LitVolarConfig['securitySystem']>('securitySystem', 'off'),
    globalTags: config.get<string[]>('globalTags', []),
    globalAttributes: config.get<string[]>('globalAttributes', []),
    globalEvents: config.get<string[]>('globalEvents', []),
    customHtmlData: config.get<string[]>('customHtmlData', []),
    customElementsManifests: config.get<string[]>('customElementsManifests', []),
    maxProjectImportDepth: config.get<number>('maxProjectImportDepth', -1),
    maxNodeModuleImportDepth: config.get<number>('maxNodeModuleImportDepth', 1),
    dontShowSuggestions: config.get<boolean>('dontShowSuggestions', false),
    logging: config.get<LitVolarConfig['logging']>('logging', 'off'),
    htmlTemplateTags: config.get<string[]>('htmlTemplateTags', ['html', 'raw']),
    cssTemplateTags: config.get<string[]>('cssTemplateTags', ['css']),
    svgTemplateTags: config.get<string[]>('svgTemplateTags', ['svg']),
  };
}
