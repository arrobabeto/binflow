export {
  createDatabase,
  type Database,
  type DatabaseTransaction,
} from './client.js';
export {
  completeIdempotencyRecord,
  createAdminOperation,
  hashCanonicalRequest,
  recordProcessedEvent,
  reserveIdempotencyKey,
  transitionAdminOperation,
  type IdempotencyReservation,
  type JsonValue,
} from './control-plane.js';
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
export {
  withPlatformOwnerScope,
  withSystemTenantScope,
  withTenantScope,
  type DatabaseExecutionScope,
  type ScopedDatabase,
} from './scope.js';
