/**
 * Re-export of the in-memory idempotency store, made discoverable
 * under the testing surface so tests don't need to reach into the
 * idempotency subpath.
 */
export { memoryStore, type MemoryStoreOptions } from '../idempotency/memory.js';
