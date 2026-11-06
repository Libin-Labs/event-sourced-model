import { createEventLog } from '@lp-labs/event-sourced-model';
const log = createEventLog();
const version: number = log.version('account-1');
const events = log.read('account-1', version);
void events;
