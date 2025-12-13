// src/lib/db/index.ts
// OneStarDB table exports and database interface types

/**
 * OneStarDB Storage Interface
 * 
 * The database provides a simple key-value store with these operations:
 * - put(key, value): Store or update a value
 * - get(key): Retrieve a value by key
 * - append(key, value): Append to a log (for append-only tables)
 * 
 * INITIALIZATION:
 * Database must be opened before accessing tables.
 * Typically done in app initialization or middleware.
 */

export interface OneStarDBInterface {
  put(key: string, value: string | null): Promise<void>;
  get(key: string): Promise<string | null>;
  append(key: string, value: string): Promise<void>;
}

/**
 * Global type augmentation for OneStarDB
 */
declare global {
  var OneStarDB: OneStarDBInterface | undefined;
}

/**
 * Initialize OneStarDB (mock implementation for development)
 * 
 * In production, this would be replaced with actual OneStarDB initialization.
 * For now, we use an in-memory Map for testing.
 */
export function initializeDB(): void {
  if (typeof globalThis !== 'undefined' && !(globalThis as any).OneStarDB) {
    const store = new Map<string, string>();
    
    (globalThis as any).OneStarDB = {
      async put(key: string, value: string | null): Promise<void> {
        if (value === null) {
          store.delete(key);
        } else {
          store.set(key, value);
        }
      },
      
      async get(key: string): Promise<string | null> {
        return store.get(key) || null;
      },
      
      async append(key: string, value: string): Promise<void> {
        const existing = store.get(key) || '';
        store.set(key, existing + '\n' + value);
      },
    };
    
    console.log('[OneStarDB] Initialized in-memory database (development mode)');
  }
}

/**
 * Check if OneStarDB is initialized
 */
export function isDBInitialized(): boolean {
  return typeof globalThis !== 'undefined' && !!(globalThis as any).OneStarDB;
}

// Export table modules
export * as MediaBlobs from './mediaBlobs.table';
export * as MediaLicenses from './mediaLicenses.table';
export * as MediaInbox from './mediaInbox.table';

// Re-export types
export type { MediaBlobRecord } from './mediaBlobs.table';
export type { MediaLicenseRecord } from './mediaLicenses.table';
export type { MediaInboxRecord } from './mediaInbox.table';
