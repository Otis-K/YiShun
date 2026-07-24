const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnv, parseEnv } = require('../web/local-env');

const parsed = parseEnv(`
# comment
PLAIN=value
QUOTED="value with # character"
SINGLE='literal value'
INLINE=value # ignored comment
export EXPORTED=yes
`);
assert.deepEqual(parsed, {
  PLAIN: 'value', QUOTED: 'value with # character', SINGLE: 'literal value', INLINE: 'value', EXPORTED: 'yes',
});

const root = path.join(__dirname, '..', 'work', `local-env-test-${process.pid}`);
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, '.env'), 'FROM_ENV=base\nOVERRIDE=base\nPROCESS_VALUE=file\n');
fs.writeFileSync(path.join(root, '.env.local'), 'OVERRIDE=local\nLOCAL_ONLY=yes\n');
const environment = { PROCESS_VALUE: 'process' };
assert.deepEqual(loadLocalEnv(root, environment), ['.env', '.env.local']);
assert.deepEqual(environment, { FROM_ENV: 'base', OVERRIDE: 'local', PROCESS_VALUE: 'process', LOCAL_ONLY: 'yes' });
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS local-env parsing local-override process-precedence');
