const fs = require('node:fs');
const path = require('node:path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const request = JSON.parse(input || '{}');
  const delay = Number(request.options && request.options.delayMs || 10);
  await new Promise(resolve => setTimeout(resolve, delay));
  fs.mkdirSync(request.outputDir, { recursive: true });
  const outputs = [];
  for (const source of request.inputs || []) {
    const extension = request.tool === 'markdown-to-html' ? '.html' : '.txt';
    const target = path.join(request.outputDir, `${path.parse(source).name}${extension}`);
    const text = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(target, request.tool === 'markdown-to-html' ? `<p>${text}</p>` : text.replace(/<[^>]+>/g, ''), 'utf8');
    outputs.push(target);
  }
  process.stdout.write(JSON.stringify({ ok: true, outputs }));
});
