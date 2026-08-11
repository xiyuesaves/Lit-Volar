import { build, context } from 'esbuild';
import { createRequire } from 'node:module';

const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);

const umdToEsm = {
  name: 'umd-to-esm',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^(vscode-.*-languageservice|jsonc-parser)/ }, args => {
      const umdPath = require.resolve(args.path, { paths: [args.resolveDir] });
      return {
        path: umdPath.replace('/umd/', '/esm/').replace('\\umd\\', '\\esm\\'),
      };
    });
  },
};

const common = {
  bundle: true,
  sourcemap: true,
  platform: 'node',
  target: 'node20',
  logLevel: 'info',
  external: ['vscode'],
  plugins: [umdToEsm],
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/client.js',
    format: 'cjs',
  },
  {
    ...common,
    entryPoints: ['src/server.ts'],
    outfile: 'dist/server.js',
    format: 'cjs',
  },
  {
    ...common,
    entryPoints: ['src/test/extension/index.ts'],
    outfile: 'dist/extension-tests/index.js',
    format: 'cjs',
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map(options => context(options)));
  await Promise.all(contexts.map(buildContext => buildContext.watch()));
  console.log('Watching Lit Volar client and server bundles...');
}
else {
  await Promise.all(builds.map(options => build(options)));
}
