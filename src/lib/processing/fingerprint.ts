import crypto from 'crypto';

export function generateFingerprint(
  message: string,
  errorType?: string | null,
  source?: string | null,
  service?: string | null
): string {
  // Normalize message for fingerprinting - remove variable parts
  let normalized = message.trim();
  
  // Remove timestamps
  normalized = normalized.replace(/\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<TIMESTAMP>');
  
  // Remove UUIDs
  normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
  
  // Remove numeric IDs
  normalized = normalized.replace(/\b\d{4,}\b/g, '<ID>');
  
  // Remove IP addresses
  normalized = normalized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>');
  
  // Remove file paths with line numbers
  normalized = normalized.replace(/[\w./-]+\:\d+/g, '<FILE:LINE>');
  
  // Remove memory addresses
  normalized = normalized.replace(/0x[0-9a-fA-F]+/g, '<ADDR>');
  
  // Build fingerprint input
  const parts = [errorType || '', source || '', service || '', normalized].filter(Boolean);
  const input = parts.join('|');
  
  return crypto.createHash('md5').update(input).digest('hex');
}

export function generateErrorTitle(message: string, errorType?: string | null): string {
  let title = message.trim();
  
  // Truncate long messages
  if (title.length > 120) {
    title = title.substring(0, 117) + '...';
  }
  
  if (errorType) {
    return `${errorType}: ${title}`;
  }
  
  return title;
}
