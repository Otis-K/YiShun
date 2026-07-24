'use strict';

const fs = require('node:fs');
const path = require('node:path');

function decodeQuoted(value, quote) {
  const inner = value.slice(1, -1);
  if (quote === "'") return inner;
  return inner.replace(/\\(n|r|t|\\|")/g, (_, escaped) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' }[escaped]));
}

function parseEnv(contents) {
  const values = {};
  for (const sourceLine of String(contents || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = decodeQuoted(value, value[0]);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function loadLocalEnv(root, environment = process.env) {
  const resolvedRoot = path.resolve(root);
  const merged = {};
  const loaded = [];
  for (const name of ['.env', '.env.local']) {
    const target = path.join(resolvedRoot, name);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    Object.assign(merged, parseEnv(fs.readFileSync(target, 'utf8')));
    loaded.push(name);
  }
  for (const [key, value] of Object.entries(merged)) {
    if (environment[key] === undefined) environment[key] = value;
  }
  return loaded;
}

module.exports = { loadLocalEnv, parseEnv };
