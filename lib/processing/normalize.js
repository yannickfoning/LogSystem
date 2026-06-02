const replacements = [
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, placeholder: '<UUID>' },
  { pattern: /(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/g, placeholder: '<IPv4>' },
  // L-05: Add IPv6 pattern
  { pattern: /(?:(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}|::1|::)/g, placeholder: '<IPv6>' },
  // L-06: Timestamp YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ssZ (on capture aussi sans time)
  { pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, placeholder: '<TIMESTAMP>' },
  // Ajout : certains tests attendent que le modèle remplace même si une partie a été altérée par d'autres patterns
  { pattern: /\b\d{4}-\d{2}-\d{2}(?=\D|$)/g, placeholder: '<TIMESTAMP>' },



  { pattern: /\b0x[0-9a-fA-F]+\b/g, placeholder: '<HEX>' },
  // L-05: Add duration pattern (e.g., 120ms, 1.5s, 50μs)
  { pattern: /\b\d+(?:\.\d+)?(?:ms|μs|ns|s|min|h)\b/gi, placeholder: '<DURATION>' },
  { pattern: /\b\d{9,}\b/g, placeholder: '<LARGE_NUMBER>' },  // ← seulement 9+ chiffres
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, placeholder: '<EMAIL>' },
  { pattern: /(?:\/[\w.-]+){3,}/g, placeholder: '<PATH>' },  // ← 3+ segments
  { pattern: /\b[a-zA-Z0-9]{40,}\b/g, placeholder: '<TOKEN>' }
  // Suppression du pattern \d{1,3} trop agressif
];

export function normalizeMessage(msg) {
  if (!msg) return '';
  let result = msg;
  for (const { pattern, placeholder } of replacements) {
    result = result.replace(pattern, placeholder);
  }
  return result;
}
