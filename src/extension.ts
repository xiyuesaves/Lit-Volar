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
let labsInfo: ReturnType<typeof createLabsInfo> | undefined;
let metadataWatchers: vscode.Disposable[] = [];
let metadataRefreshTimer: ReturnType<typeof setTimeout> | undefined;

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
  resetMetadataWatchers(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('litVolar')) {
        resetMetadataWatchers(context);
        void client?.sendNotification('litVolar/updateConfig', readConfig());
      }
    }),
    { dispose: disposeMetadataWatchers },
  );

  return labsInfo.extensionExports;
}

function resetMetadataWatchers(context: vscode.ExtensionContext): void {
  disposeMetadataWatchers();
  const config = vscode.workspace.getConfiguration('litVolar', vscode.workspace.workspaceFolders?.[0]?.uri);
  const patterns = new Set([
    '**/{package.json,tsconfig.json,jsconfig.json,custom-elements.json}',
    ...config.get<string[]>('customHtmlData', []),
    ...config.get<string[]>('customElementsManifests', []),
  ]);
  for (const pattern of patterns) {
    if (!pattern.trim()) continue;
    const watcher = vscode.workspace.createFileSystemWatcher(pattern.replace(/\\/g, '/'));
    metadataWatchers.push(
      watcher,
      watcher.onDidCreate(() => notifyMetadataRefresh()),
      watcher.onDidChange(() => notifyMetadataRefresh()),
      watcher.onDidDelete(() => notifyMetadataRefresh()),
    );
  }
}

function disposeMetadataWatchers(): void {
  if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer);
  metadataRefreshTimer = undefined;
  for (const watcher of metadataWatchers) watcher.dispose();
  metadataWatchers = [];
}

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  const litVolarConfig = readConfig();
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
      litVolar: litVolarConfig,
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

function notifyMetadataRefresh(): void {
  if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer);
  metadataRefreshTimer = setTimeout(() => {
    metadataRefreshTimer = undefined;
    void client?.sendNotification('litVolar/refresh');
  }, 250);
}

function readConfig(): LitVolarConfig {
  const config = vscode.workspace.getConfiguration('litVolar', vscode.workspace.workspaceFolders?.[0]?.uri);
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
