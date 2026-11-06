import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
test('loads and replays from the CommonJS build', () => {
  const { createEventLog } = require('../dist/cjs/index.js');
  const log = createEventLog();
  log.append('a', 0, [{ type: 'add', payload: 1 }]);
  assert.equal(
    log.replay('a', (state = 0, event) => state + event.payload),
    1,
  );
});
