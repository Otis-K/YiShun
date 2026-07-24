const path = require('node:path');
const { sourceManifest, writeJson } = require('./acceptance-lib');

const root = path.resolve(__dirname, '..', '..');
const output = path.resolve(process.argv[2] || path.join(root, 'work', 'acceptance-current', 'SOURCE_MANIFEST.json'));
const manifest = sourceManifest(root);
writeJson(output, manifest);
console.log(`PASS source-manifest files=${manifest.sourceFileCount} fingerprint=${manifest.sourceFingerprint}`);
