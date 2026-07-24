const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const output = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'work', 'devil-samples'));
const seed = 20260713;
fs.mkdirSync(output, { recursive: true });

const textDir = path.join(output, 'text');
const malformedDir = path.join(output, 'malformed');
fs.mkdirSync(textDir, { recursive: true });
fs.mkdirSync(malformedDir, { recursive: true });
const names = ['中文-超长文件名-用于验证界面不会溢出.txt', '日本語.txt', 'العربية.txt', 'emoji-🧪.txt'];
for (let index = 0; index < 100; index += 1) {
  const name = index < names.length ? names[index] : `batch-${String(index).padStart(4, '0')}.txt`;
  fs.writeFileSync(path.join(textDir, name), `seed=${seed}\nindex=${index}\n工具加压测试\n`, 'utf8');
}
fs.writeFileSync(path.join(malformedDir, 'zero-byte.txt'), Buffer.alloc(0));
fs.writeFileSync(path.join(malformedDir, 'fake.pdf'), Buffer.from('not a pdf'));
fs.writeFileSync(path.join(malformedDir, 'truncated.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
const random = Buffer.alloc(4096);
let state = seed;
for (let index = 0; index < random.length; index += 1) {
  state = (state * 1664525 + 1013904223) >>> 0;
  random[index] = state & 0xff;
}
fs.writeFileSync(path.join(malformedDir, 'seeded-random.bin'), random);

const inventory = walk(output).map(file => ({
  path: path.relative(output, file),
  bytes: fs.statSync(file).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}));
fs.writeFileSync(path.join(output, 'inventory.json'), `${JSON.stringify({ seed, files: inventory }, null, 2)}\n`);
console.log(`PASS devil-samples ${inventory.length} deterministic files ${output}`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
