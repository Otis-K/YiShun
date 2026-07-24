const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const backendPath = path.join(root, 'bin', 'toolplus-backend.exe');
const response = JSON.parse(execFileSync(backendPath, ['catalog'], { encoding: 'utf8' }));
if (!response.ok || !Array.isArray(response.tools)) throw new Error('backend catalog response is invalid');
const backendKeys = response.tools.map(tool => tool.key);
if (new Set(backendKeys).size !== backendKeys.length) {
  throw new Error('backend catalog contains duplicate keys');
}
for (const tool of response.tools) {
  if (!tool.title || !tool.category || !tool.description || !tool.inputKind || !Array.isArray(tool.params)) {
    throw new Error(`incomplete shared catalog entry: ${tool.key}`);
  }
}
console.log(`PASS shared-catalog ${backendKeys.length} complete tool definitions`);
