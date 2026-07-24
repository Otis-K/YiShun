let body = '';
const path = require('node:path');
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { body += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(body || '{}');
  const delay = Number(request.options && request.options.delayMs) || 20;
  setTimeout(() => {
    const failInput = request.options && request.options.failInput;
    const matchedFailure = failInput && Array.isArray(request.inputs) && request.inputs.some(input => String(input).includes(failInput));
    if (request.options && request.options.fail === 'true' || matchedFailure) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'fixture failure' }));
    } else {
      const suffix = Array.isArray(request.inputs) && request.inputs[0] ? path.basename(request.inputs[0]) : 'fixture';
      process.stdout.write(JSON.stringify({ ok: true, outputs: [request.outputDir + `\\${suffix}.txt`] }));
    }
  }, delay);
});
