import fs from 'node:fs';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

const projectRoot = process.cwd();
const workspacePath = path.join(projectRoot, '.vscode-test', 'workspace');
fs.rmSync(workspacePath, { recursive: true, force: true });
fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
fs.cpSync(path.join(projectRoot, 'samples'), workspacePath, {
  recursive: true,
  filter: source => path.basename(source) !== 'node_modules',
});
fs.symlinkSync(path.join(projectRoot, 'samples', 'node_modules'), path.join(workspacePath, 'node_modules'), 'junction');

await runTests({
  ...(process.env.VSCODE_EXECUTABLE_PATH
    ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
    : { version: '1.90.2' }),
  extensionDevelopmentPath: projectRoot,
  extensionTestsPath: path.join(projectRoot, 'dist', 'extension-tests', 'index.js'),
  launchArgs: [workspacePath, '--disable-extensions'],
});
