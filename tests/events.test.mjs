import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventLog, EventLogError } from '../dist/esm/index.js';

test('appends events with aggregate versions and global sequences', () => {
  const log = createEventLog();
  const first = log.append('a', 0, [
    { type: 'Open', payload: {} },
    { type: 'Add', payload: { n: 1 } },
  ]);
  const second = log.append('b', 0, [{ type: 'Open', payload: null }]);
  assert.deepEqual(
    first.map((e) => e.version),
    [1, 2],
  );
  assert.deepEqual(
    second.map((e) => e.sequence),
    [3],
  );
});
test('reads after a version with a result limit', () => {
  const log = createEventLog();
  log.append('a', 0, [
    { type: 'one', payload: 1 },
    { type: 'two', payload: 2 },
  ]);
  assert.deepEqual(
    log.read('a', 1, 1).map((e) => e.type),
    ['two'],
  );
});
test('replays only the selected aggregate', () => {
  const log = createEventLog();
  log.append('a', 0, [{ type: 'add', payload: 2 }]);
  log.append('b', 0, [{ type: 'add', payload: 8 }]);
  assert.equal(
    log.replay('a', (state = 0, event) => state + event.payload),
    2,
  );
});
test('detects stale expected aggregate versions', () => {
  const log = createEventLog();
  log.append('a', 0, [{ type: 'one', payload: null }]);
  assert.throws(
    () => log.append('a', 0, [{ type: 'two', payload: null }]),
    (e) => e instanceof EventLogError && e.code === 'version-conflict',
  );
});
test('makes a multi-event append atomic at capacity', () => {
  const log = createEventLog({ maxEvents: 1 });
  assert.throws(
    () =>
      log.append('a', 0, [
        { type: 'a', payload: 1 },
        { type: 'b', payload: 2 },
      ]),
    EventLogError,
  );
  assert.equal(log.size(), 0);
  assert.equal(log.version('a'), 0);
});
test('enforces per-aggregate capacity', () => {
  const log = createEventLog({ maxEventsPerAggregate: 1 });
  log.append('a', 0, [{ type: 'one', payload: 1 }]);
  assert.throws(() => log.append('a', 1, [{ type: 'two', payload: 2 }]), EventLogError);
});
test('detaches payloads on append and read', () => {
  const log = createEventLog();
  const payload = { list: [1] };
  log.append('a', 0, [{ type: 'add', payload }]);
  payload.list.push(2);
  const read = log.read('a');
  read[0].payload.list.push(3);
  assert.deepEqual(log.read('a')[0].payload, { list: [1] });
});
test('validates aggregate, event type, and expected version', () => {
  const log = createEventLog();
  assert.throws(() => log.append('', 0, [{ type: 'a', payload: null }]), EventLogError);
  assert.throws(() => log.append('a', 0, [{ type: '', payload: null }]), EventLogError);
  assert.throws(() => log.append('a', -1, [{ type: 'a', payload: null }]), EventLogError);
  assert.throws(
    () => log.append('a', 0, [{ type: 'a', payload: null, extra: true }]),
    EventLogError,
  );
  assert.throws(() => createEventLog({ unexpected: 1 }), EventLogError);
});
test('requires a non-empty bounded batch and bounded read options', () => {
  const log = createEventLog();
  assert.throws(() => log.append('a', 0, []), EventLogError);
  assert.throws(() => log.read('a', 0, 0), EventLogError);
});
test('handles empty streams and checks reducer', () => {
  const log = createEventLog();
  assert.equal(
    log.replay('empty', (state = 0) => state + 1),
    undefined,
  );
  assert.throws(() => log.replay('empty', null), EventLogError);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => log.append('empty', 0, sparse), EventLogError);
});
