import { activateAutoInsertion, createLabsInfo } from '@volar/vscode';
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

const documentSelector: DocumentSelector = [
  ...['file', 'untitled'].flatMap(scheme => [
    { scheme, language: 'javascript' },
    { scheme, language: 'javascriptreact' },
    { scheme, language: 'typescript' },
    { scheme, language: 'typescriptreact' },
  ]),
];

export async function activate(context: vscode.ExtensionContext) {
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
    },
  };

  client = new LanguageClient(
    'lit-volar-language-server',
    'Lit Volar Language Server',
    serverOptions,
    clientOptions,
  );
  await client.start();

  context.subscriptions.push(
    activateAutoInsertion(documentSelector, client),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('litVolar')) {
        void vscode.window.showInformationMessage(
          'Lit Volar template tag settings changed. Reload the window to apply them.',
          'Reload Window',
        ).then(choice => {
          if (choice === 'Reload Window') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
      }
    }),
  );

  const labsInfo = createLabsInfo();
  labsInfo.addLanguageClient(client);
  return labsInfo.extensionExports;
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

function readConfig(): LitVolarConfig {
  const config = vscode.workspace.getConfiguration('litVolar');
  return {
    htmlTemplateTags: config.get<string[]>('htmlTemplateTags', ['html', 'raw']),
    cssTemplateTags: config.get<string[]>('cssTemplateTags', ['css']),
    svgTemplateTags: config.get<string[]>('svgTemplateTags', ['svg']),
  };
}
