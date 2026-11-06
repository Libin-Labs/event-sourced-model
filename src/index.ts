export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface EventInput {
  type: string;
  payload: Json;
}
export interface DomainEvent extends EventInput {
  readonly aggregateId: string;
  readonly version: number;
  readonly sequence: number;
}
export interface EventLogOptions {
  maxEvents?: number;
  maxEventsPerAggregate?: number;
}
export interface EventLog {
  version(aggregateId: string): number;
  append(
    aggregateId: string,
    expectedVersion: number,
    events: readonly EventInput[],
  ): readonly DomainEvent[];
  read(aggregateId: string, afterVersion?: number, limit?: number): readonly DomainEvent[];
  replay<State>(
    aggregateId: string,
    reducer: (state: State | undefined, event: DomainEvent) => State,
  ): State | undefined;
  size(): number;
}
export class EventLogError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity' | 'version-conflict',
    message: string,
  ) {
    super(message);
    this.name = 'EventLogError';
  }
}
function integer(value: number, name: string, minimum = 0, maximum = 1_000_000): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new EventLogError('invalid', `${name} must be an integer from ${minimum} to ${maximum}.`);
}
function aggregate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256)
    throw new EventLogError('invalid', 'Aggregate IDs must contain 1..256 characters.');
}
function copy(value: unknown, depth = 0, budget = { nodes: 0, characters: 0 }): Json {
  if (++budget.nodes > 10_000 || depth > 32)
    throw new EventLogError('capacity', 'Event payload exceeds JSON limits.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.characters += value.length;
    if (budget.characters > 1_000_000)
      throw new EventLogError('capacity', 'Event payload exceeds the text limit.');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1)
      throw new EventLogError(
        'invalid',
        'Payload arrays must be dense and have no extra properties.',
      );
    const result: Json[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new EventLogError('invalid', 'Payload arrays must contain data elements.');
      result.push(copy(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const entries: [string, Json][] = [];
    for (const key of Reflect.ownKeys(value)) {
      const descriptor =
        typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
      if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor))
        throw new EventLogError('invalid', 'Payloads must use enumerable string data fields.');
      if (key.length > 256)
        throw new EventLogError('invalid', 'Payload keys are limited to 256 characters.');
      budget.characters += key.length;
      if (budget.characters > 1_000_000)
        throw new EventLogError('capacity', 'Event payload exceeds the text limit.');
      entries.push([key, copy(descriptor.value, depth + 1, budget)]);
    }
    return Object.fromEntries(entries) as { [key: string]: Json };
  }
  throw new EventLogError('invalid', 'Payloads must contain only JSON-compatible data.');
}
function positiveOption(value: number, name: string, max: number): number {
  integer(value, name, 1, max);
  return value;
}
export function createEventLog(options: EventLogOptions = {}): EventLog {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
  )
    throw new EventLogError('invalid', 'Options must be a plain object.');
  for (const key of Reflect.ownKeys(options)) {
    const descriptor =
      typeof key === 'string' ? Object.getOwnPropertyDescriptor(options, key) : undefined;
    if (
      typeof key !== 'string' ||
      !['maxEvents', 'maxEventsPerAggregate'].includes(key) ||
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'number'
    )
      throw new EventLogError('invalid', 'Options contain an unsupported or invalid field.');
  }
  const maxEvents = positiveOption(options.maxEvents ?? 100_000, 'maxEvents', 1_000_000);
  const maxPerAggregate = positiveOption(
    options.maxEventsPerAggregate ?? 10_000,
    'maxEventsPerAggregate',
    100_000,
  );
  const events: DomainEvent[] = [];
  const versions = new Map<string, number>();
  let storedPayloadCharacters = 0;
  return {
    version(id) {
      aggregate(id);
      return versions.get(id) ?? 0;
    },
    append(id, expectedVersion, input) {
      aggregate(id);
      integer(expectedVersion, 'expectedVersion');
      if (
        !Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Array.prototype ||
        input.length === 0 ||
        input.length > 1000 ||
        Reflect.ownKeys(input).length !== input.length + 1
      )
        throw new EventLogError('invalid', 'Append must contain 1..1000 events.');
      for (let index = 0; index < input.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new EventLogError('invalid', 'Append arrays must contain data elements.');
      }
      const current = versions.get(id) ?? 0;
      if (current !== expectedVersion)
        throw new EventLogError(
          'version-conflict',
          `Expected version ${expectedVersion}; current version is ${current}.`,
        );
      if (events.length + input.length > maxEvents || current + input.length > maxPerAggregate)
        throw new EventLogError('capacity', 'Append would exceed event log capacity.');
      const prepared: Array<{ type: string; payload: Json }> = [];
      let batchPayloadCharacters = 0;
      for (const event of input) {
        if (
          event === null ||
          typeof event !== 'object' ||
          Array.isArray(event) ||
          (Object.getPrototypeOf(event) !== Object.prototype &&
            Object.getPrototypeOf(event) !== null) ||
          Reflect.ownKeys(event).length !== 2 ||
          !Object.hasOwn(event, 'type') ||
          !Object.hasOwn(event, 'payload') ||
          !Object.getOwnPropertyDescriptor(event, 'type')?.enumerable ||
          !('value' in Object.getOwnPropertyDescriptor(event, 'type')!) ||
          !Object.getOwnPropertyDescriptor(event, 'payload')?.enumerable ||
          !('value' in Object.getOwnPropertyDescriptor(event, 'payload')!) ||
          typeof event.type !== 'string' ||
          event.type.length < 1 ||
          event.type.length > 128
        )
          throw new EventLogError('invalid', 'Event type must contain 1..128 characters.');
        const payload = copy(event.payload);
        batchPayloadCharacters += event.type.length + JSON.stringify(payload).length;
        if (batchPayloadCharacters > 5_000_000)
          throw new EventLogError('capacity', 'Append exceeds the batch payload limit.');
        prepared.push({ type: event.type, payload });
      }
      if (storedPayloadCharacters + batchPayloadCharacters > 50_000_000)
        throw new EventLogError('capacity', 'Event log payload capacity reached.');
      const appended = prepared.map((event, index) => ({
        ...event,
        aggregateId: id,
        version: current + index + 1,
        sequence: events.length + index + 1,
      }));
      events.push(...appended);
      storedPayloadCharacters += batchPayloadCharacters;
      versions.set(id, current + appended.length);
      return appended.map((event) => ({ ...event, payload: copy(event.payload) }));
    },
    read(id, afterVersion = 0, limit = 1000) {
      aggregate(id);
      integer(afterVersion, 'afterVersion');
      integer(limit, 'limit', 1, 10_000);
      return events
        .filter((event) => event.aggregateId === id && event.version > afterVersion)
        .slice(0, limit)
        .map((event) => ({ ...event, payload: copy(event.payload) }));
    },
    replay<State>(id: string, reducer: (state: State | undefined, event: DomainEvent) => State) {
      aggregate(id);
      if (typeof reducer !== 'function')
        throw new EventLogError('invalid', 'Reducer must be a function.');
      let state: State | undefined;
      for (const event of events) {
        if (event.aggregateId === id)
          state = reducer(state, { ...event, payload: copy(event.payload) });
      }
      return state;
    },
    size() {
      return events.length;
    },
  };
}
