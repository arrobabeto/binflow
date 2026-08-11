export { createDatabase, type Database } from './client.js';
export { runMigrations } from './migrate.js';
export {
  ensureDraftScope,
  listCredentials,
  resolveScope,
  revokeCredential,
  storeCredentialVersion,
  type ResolvedScope,
} from './repository.js';
export * as schema from './schema.js';
