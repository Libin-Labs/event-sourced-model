import { createEventLog, type EventInput } from '@lp-labs/event-sourced-model';
const log = createEventLog({ maxEvents: 50 });
const input: EventInput = { type: 'Opened', payload: { at: 1 } };
log.append('order-1', 0, [input]);
const count: number | undefined = log.replay('order-1', (state = 0) => state + 1);
void count;
