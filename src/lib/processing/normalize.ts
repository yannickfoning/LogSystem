export function normalizeMessage(message: string): string {
  if (!message) return '';
  
  let normalized = message.trim();
  
  // Remove leading timestamps
  normalized = normalized.replace(/^\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*/i, '');
  
  // Remove leading log level prefixes
  normalized = normalized.replace(/^\[(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL)\]\s*/i, '');
  normalized = normalized.replace(/^(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL)\s*[:|-]\s*/i, '');
  
  // Remove PID patterns
  normalized = normalized.replace(/\[?\d{1,7}\]?\s*[:|-]\s*/, '');
  
  // Remove source file patterns
  normalized = normalized.replace(/^(?:at\s+)?[\w./]+\(\d+\):\s*/, '');
  
  // Collapse multiple spaces
  normalized = normalized.replace(/\s{2,}/g, ' ');
  
  return normalized.trim();
}

export function extractErrorType(message: string): string | null {
  const errorPatterns = [
    /(\w+Error):/i,
    /(\w+Exception)/i,
    /(\w+Fault)/i,
    /FATAL:\s*(\w+)/i,
    /CRITICAL:\s*(\w+)/i,
    /ERROR:\s*(\w+)/i,
  ];
  
  for (const pattern of errorPatterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

export function extractStackTrace(message: string): string | null {
  const stackPattern = /(?:at\s+[\w.$]+\s*\([^)]*\)(?:\n|$))+/m;
  const match = message.match(stackPattern);
  return match ? match[0].trim() : null;
}
