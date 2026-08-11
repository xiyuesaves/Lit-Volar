import {
  createConnection,
  createServer,
  createTypeScriptProject,
  loadTsdkByPath,
} from '@volar/language-server/node';
import ts from 'typescript';
import { create as createCssService } from 'volar-service-css';
import { create as createEmmetService } from 'volar-service-emmet';
import { create as createHtmlService } from 'volar-service-html';
import { defaultConfig, normalizeConfig, touchConfig, updateConfig, type LitVolarConfig } from './config';
import { wrapCssService } from './cssService';
import { withLitDomBindings } from './htmlService';
import { createLitLanguagePlugin } from './languagePlugin';
import { createLitProjectService } from './litService';
import { createDomHtmlDataProvider } from './bindingRegistry';
import { svgHtmlDataProvider } from './svgHtmlData';
import { createTypeScriptBridge } from './typescriptBridge';
import { loadCemProjectData, type CemProjectData } from './cemData';
import { URI } from 'vscode-uri';

const connection = createConnection();
const server = createServer(connection);
let activeConfig: LitVolarConfig = { ...defaultConfig };
let workspaceCemData: CemProjectData = { elements: new Map(), htmlData: [], manifestFiles: [] };
let refreshWorkspaceCem = () => {};

connection.listen();

connection.onInitialize(params => {
  const initializationOptions = params.initializationOptions as {
    litVolar?: Partial<LitVolarConfig>;
    typescript?: { tsdk?: string };
  } | undefined;
  const config = normalizeConfig(initializationOptions?.litVolar);
  activeConfig = config;
  const loadedTs = initializationOptions?.typescript?.tsdk
    ? loadTsdkByPath(initializationOptions.typescript.tsdk, params.locale)
    : { typescript: ts, diagnosticMessages: undefined };
  const domHtmlDataProvider = createDomHtmlDataProvider(loadedTs.typescript);
  const workspaceRoot = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
  const projectRoot = workspaceRoot ? URI.parse(workspaceRoot).fsPath : process.cwd();
  refreshWorkspaceCem = () => {
    workspaceCemData = loadCemProjectData(projectRoot, config, undefined, loadedTs.typescript);
  };
  refreshWorkspaceCem();
  return server.initialize(
    params,
    createTypeScriptProject(loadedTs.typescript, loadedTs.diagnosticMessages, () => ({
      languagePlugins: [createLitLanguagePlugin(() => config)],
    })),
    [
      createTypeScriptBridge(loadedTs.typescript),
      createLitProjectService(loadedTs.typescript, config),
      withLitDomBindings(createHtmlService({
        documentSelector: ['html'],
        getCustomData: () => [domHtmlDataProvider],
      }), domHtmlDataProvider, config, () => workspaceCemData),
      withLitDomBindings(createHtmlService({
        documentSelector: ['svg'],
        useDefaultDataProvider: false,
        getCustomData: () => [svgHtmlDataProvider, domHtmlDataProvider],
      }), domHtmlDataProvider, config, () => workspaceCemData),
      wrapCssService(createCssService(), config),
      createEmmetService(),
    ],
  );
});

connection.onNotification('litVolar/updateConfig', (value: Partial<LitVolarConfig>) => {
  updateConfig(activeConfig, value);
  refreshWorkspaceCem();
  requestDiagnosticRefresh();
});
connection.onNotification('litVolar/refresh', () => {
  touchConfig(activeConfig);
  refreshWorkspaceCem();
  requestDiagnosticRefresh();
});

function requestDiagnosticRefresh(): void {
  try {
    connection.languages.diagnostics.refresh();
  }
  catch {
    // Older clients can omit workspace diagnostic refresh support.
  }
}

connection.onInitialized(server.initialized);
connection.onShutdown(server.shutdown);
