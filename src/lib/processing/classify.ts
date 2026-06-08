export type EventType = 
  | 'authentication'
  | 'authorization'
  | 'database'
  | 'network'
  | 'system'
  | 'application'
  | 'security'
  | 'deployment'
  | 'performance'
  | 'general';

const EVENT_PATTERNS: Array<{ patterns: RegExp[]; type: EventType }> = [
  {
    patterns: [
      /\b(login|logout|sign\s*in|sign\s*out|auth(?:entication|orization)?)\b/i,
      /\bsession\s*(expired|invalid|created|destroyed)\b/i,
      /\btoken\s*(invalid|expired|refresh)\b/i,
      /\bpassword\s*(change|reset|expired|invalid)\b/i,
    ],
    type: 'authentication',
  },
  {
    patterns: [
      /\bpermission\s*denied\b/i,
      /\bforbidden\b/i,
      /\baccess\s*denied\b/i,
      /\b(unauthorized|not\s*authorized)\b/i,
      /\brbac\b/i,
    ],
    type: 'authorization',
  },
  {
    patterns: [
      /\bdb\b|\bdatabase\b|\bsql\b|\bquery\b/i,
      /\bconnection\s*(pool|timeout|refused|lost)\b/i,
      /\bdeadlock\b/i,
      /\bmigration\b/i,
      /\bprisma\b/i,
    ],
    type: 'database',
  },
  {
    patterns: [
      /\bhttp\b|\brequest\b|\bresponse\b/i,
      /\btimeout\b/i,
      /\bconnection\s*(reset|refused|closed)\b/i,
      /\bdns\b/i,
      /\bsocket\b/i,
      /\bgateway\b/i,
      /\bproxy\b/i,
    ],
    type: 'network',
  },
  {
    patterns: [
      /\bos\b|\bkernel\b|\bcpu\b|\bmemory\b|\bdisk\b/i,
      /\bprocess\s*(killed|crashed|oom)\b/i,
      /\bsystem\s*(start|stop|restart)\b/i,
      /\bservice\s*(start|stop|restart)\b/i,
    ],
    type: 'system',
  },
  {
    patterns: [
      /\bdeploy(?:ment)?\b/i,
      /\brelease\b/i,
      /\bbuild\b/i,
      /\bci\/cd\b/i,
      /\bpipeline\b/i,
      /\brollback\b/i,
    ],
    type: 'deployment',
  },
  {
    patterns: [
      /\bsecurity\b/i,
      /\b(brute\s*force|attack|breach|vulnerability)\b/i,
      /\bsuspicious\b/i,
      /\bmalicious\b/i,
      /\bfirewall\b/i,
    ],
    type: 'security',
  },
  {
    patterns: [
      /\bslow\b|\blatency\b|\bthroughput\b/i,
      /\bperformance\b/i,
      /\bbottleneck\b/i,
      /\boom\b/i,
      /\bout\s*of\s*memory\b/i,
    ],
    type: 'performance',
  },
];

export function classifyEvent(message: string, level: string): EventType {
  for (const { patterns, type } of EVENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) return type;
    }
  }
  
  // Infer from level
  if (level === 'CRITICAL' || level === 'FATAL') return 'system';
  if (level === 'ERROR') return 'application';
  
  return 'general';
}
