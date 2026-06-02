import crypto from 'crypto';

export function generateFingerprint(service, eventType, normalizedMessage, userId = null) {
  // L-04: Include user_id in fingerprint hash for tenant isolation
  const str = `${service || ''}|||${eventType || ''}|||${normalizedMessage || ''}|||${userId || ''}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 40); // 40 chars pour rétrocompatibilité
}
