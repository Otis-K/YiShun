import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const withNodeExtension = specifier => {
  if (!specifier.startsWith('.')) return specifier;
  return path.posix.extname(specifier) ? specifier : `${specifier}.js`;
};

for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
  const declaration = path.join(entry.parentPath ?? entry.path, entry.name);
  const source = readFileSync(declaration, 'utf8');
  const finalized = source
    .replace(/^import ['"]\.\/styles\.css['"];\r?\n/m, '')
    .replace(/(\bfrom\s*['"])(\.\.?\/[^'"]+)(['"])/g,
      (_match, before, specifier, after) => `${before}${withNodeExtension(specifier)}${after}`)
    .replace(/(\bimport\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g,
      (_match, before, specifier, after) => `${before}${withNodeExtension(specifier)}${after}`);

  if (source !== finalized) writeFileSync(declaration, finalized);
  const commonJsDeclaration = finalized
    .replace(/(\bfrom\s*['"])(\.\.?\/[^'"]+?\.js)(['"])/g,
      (_match, before, specifier, after) => `${before}${specifier.slice(0, -3)}.cjs${after}`)
    .replace(/(\bimport\s*\(\s*['"])(\.\.?\/[^'"]+?\.js)(['"]\s*\))/g,
      (_match, before, specifier, after) => `${before}${specifier.slice(0, -3)}.cjs${after}`);
  writeFileSync(declaration.replace(/\.d\.ts$/, '.d.cts'), commonJsDeclaration);
}
