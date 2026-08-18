export { createDatabase, type Database } from './client.js';
export { runMigrations } from './migrate.js';
export {
  ensureDraftScope,
  getCredentialForVerification,
  listCredentialIdsForVerification,
  listCredentials,
  recordCredentialVerificationFailure,
  recordCredentialVerificationSuccess,
  resolveScope,
  revokeCredential,
  storeCredentialVersion,
  type CredentialForVerification,
  type ResolvedScope,
  type SafeConfiguration,
} from './repository.js';
export * as schema from './schema.js';
