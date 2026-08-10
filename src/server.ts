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
import { normalizeConfig, type LitVolarConfig } from './config';
import { wrapCssService } from './cssService';
import { createLitLanguagePlugin } from './languagePlugin';
import { createLitProjectService } from './litService';
import { litHtmlDataProvider } from './litHtmlData';
import { svgHtmlDataProvider } from './svgHtmlData';
import { createTypeScriptBridge } from './typescriptBridge';

const connection = createConnection();
const server = createServer(connection);

connection.listen();

connection.onInitialize(params => {
  const initializationOptions = params.initializationOptions as {
    litVolar?: Partial<LitVolarConfig>;
    typescript?: { tsdk?: string };
  } | undefined;
  const config = normalizeConfig(initializationOptions?.litVolar);
  const loadedTs = initializationOptions?.typescript?.tsdk
    ? loadTsdkByPath(initializationOptions.typescript.tsdk, params.locale)
    : { typescript: ts, diagnosticMessages: undefined };
  return server.initialize(
    params,
    createTypeScriptProject(loadedTs.typescript, loadedTs.diagnosticMessages, () => ({
      languagePlugins: [createLitLanguagePlugin(config)],
    })),
    [
      createTypeScriptBridge(loadedTs.typescript),
      createLitProjectService(loadedTs.typescript, config),
      createHtmlService({
        documentSelector: ['html'],
        getCustomData: () => [litHtmlDataProvider],
      }),
      createHtmlService({
        documentSelector: ['svg'],
        useDefaultDataProvider: false,
        getCustomData: () => [svgHtmlDataProvider, litHtmlDataProvider],
      }),
      wrapCssService(createCssService(), config),
      createEmmetService(),
    ],
  );
});

connection.onInitialized(server.initialized);
connection.onShutdown(server.shutdown);
