const patterns = {
  auth: [
    /\b(login|logout|auth|token|session|password|credential|bearer)\b/i,
    /\b(unauthorized|forbidden|401|403)\b/i,
    /\bjwt\b|\boauth\b|\bsaml\b|\bsso\b/i
  ],
  database: [
    /\b(sql|query|mysql|postgres|mongodb|select|insert|update|delete\s+from)\b/i,
    /\b(connection.*(?:fail|timeout|refused|error))\b/i,
    /\b(deadlock|table.*lock|constraint|foreign key)\b/i
  ],
  security: [
    /\b(xss|csrf|injection|exploit|vulnerability|malware|attack)\b/i,
    /\b(firewall|blocked|suspicious|intrusion|brute\s*force)\b/i,
    /\b(certificate|tls|ssl|ciphertext)\b/i
  ],
  system: [
    /\b(kernel|oom|segfault|signal|core dump|panic)\b/i,
    /\b(cpu|memory|disk|network.*usage)\b/i,
    /\b(startup|shutdown|restart|boot)\b/i,
    /\b(pod|container|docker|kubernetes|k8s)\b/i
  ],
  exception: [
    /\b(error|exception|throw|fatal|crash)\b/i,
    /\b(nullpointer|null reference|typeerror|referenceerror)\b/i,
    /\b(at\s+\S+\s+\(.*\d+\))\b/i,
    /\b(stack\s*trace|stacktrace)\b/i
  ],
  api: [
    /\b(get|post|put|delete|patch)\s+\/\S+/i,
    /\b(endpoint|route|request|response)\b/i,
    /\b(http\/\d|status\s*code|content-type)\b/i
  ],
  performance: [
    /\b(slow|timeout|latency|throughput|performance)\b/i,
    /\b(elapsed|duration|took|execution time)\b/i,
    /\b(heap|gc\s*pause|memory leak)\b/i
  ],
  cron: [
    /\b(cron|scheduled|job|task|worker|queue)\b/i,
    /\b(batch|periodic|recurring|interval)\b/i
  ],
  deployment: [
    /\b(deploy|release|version|rollback|migration)\b/i,
    /\b(build|compile|bundle|artifact)\b/i,
    /\b(ci|cd|pipeline|jenkins|github actions)\b/i
  ]
};

export function classifyLog(message, source, service) {
  const msg = String(message ?? '');
  const src = String(source ?? '');
  const svc = String(service ?? '');

  const text = `${msg} ${src} ${svc}`.toLowerCase();

  // Règles prioritaires attendues par les tests
  // 1) database_query (SELECT/INSERT/UPDATE/DELETE)
  if (/(\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bsql\b|\bfrom\b)/i.test(msg)) {
    // éviter collision avec le type `database` existant
    return 'database_query';
  }

  // 2) auth/authentication
  if (/(authentication|unauthorized|forbidden|login|logout|token|session|jwt|oauth|sso)/i.test(msg)) {
    return 'authentication';
  }

  // 3) error: exception / null pointer / stacktrace
  if (/(error|exception|throw|fatal|crash|nullpointer|null pointer)/i.test(msg)) {
    return 'error';
  }

  // fallback : garder la logique historique
  for (const [type, rules] of Object.entries(patterns)) {
    for (const pattern of rules) {
      if (pattern.test(text)) return type;
    }
  }
  return 'generic';
}

