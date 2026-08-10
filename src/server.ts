import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node';
import { create as createCssService } from 'volar-service-css';
import { create as createEmmetService } from 'volar-service-emmet';
import { create as createHtmlService } from 'volar-service-html';
import type { LitVolarConfig } from './config';
import { createLitLanguagePlugin } from './languagePlugin';
import { litHtmlDataProvider } from './litHtmlData';
import { svgHtmlDataProvider } from './svgHtmlData';

const connection = createConnection();
const server = createServer(connection);

connection.listen();

connection.onInitialize(params => {
  const config = params.initializationOptions?.litVolar as Partial<LitVolarConfig> | undefined;
  return server.initialize(
    params,
    createSimpleProject([createLitLanguagePlugin(config)]),
    [
      createHtmlService({
        documentSelector: ['html'],
        getCustomData: () => [litHtmlDataProvider],
      }),
      createHtmlService({
        documentSelector: ['svg'],
        useDefaultDataProvider: false,
        getCustomData: () => [svgHtmlDataProvider, litHtmlDataProvider],
      }),
      createCssService(),
      createEmmetService(),
    ],
  );
});

connection.onInitialized(server.initialized);
connection.onShutdown(server.shutdown);
