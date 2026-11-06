# @lp-labs/event-sourced-model

A bounded, in-memory append-only event log for aggregate versioning and replay.

## Install

```sh
npm install @lp-labs/event-sourced-model
```

## Quickstart

```js
import { createEventLog } from '@lp-labs/event-sourced-model';

const log = createEventLog();
log.append('cart-1', 0, [{ type: 'ItemAdded', payload: { sku: 'pen' } }]);
const items = log.replay(
  'cart-1',
  (state = 0, event) => state + (event.type === 'ItemAdded' ? 1 : 0),
);
```

## API

`createEventLog({ maxEvents?, maxEventsPerAggregate? })` supports
`version(id)`, `append(id, expectedVersion, events)`, `read(id, afterVersion?,
limit?)`, `replay(id, reducer)`, and `size()`. Appends are synchronous, require
the current aggregate version, and accept 1..1,000 JSON events. Appends are
all-or-nothing. Each event receives an aggregate version and process-local
sequence. Default limits are 100,000 total events, 10,000 per aggregate, and
1,000 events per append. Each JSON payload is limited to 10,000 nodes, 32
levels, and 1,000,000 characters; a batch is capped at 5,000,000 serialized
characters and the log at 50,000,000. `EventLogError` reports invalid input,
capacity, and version conflicts.

## Customization

Choose total/per-aggregate limits based on the process memory budget. Use a
reducer to project events into a domain-specific state; keep reducers pure for
repeatable replay.

## Limitations

The log is memory-only and is cleared on process exit; it is not a durable event
store, delivery system, or distributed conflict resolver. Event payloads are
plain JSON. Replay recomputes from the beginning and does not persist snapshots.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
