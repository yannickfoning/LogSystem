/**
 * Log metadata enrichment — event timestamp, source system, main service, hostname, origin.
 */

const SOURCE_RULES = [
  { re: /\b(fortinet|fortigate|fortios)\b/i, source: 'Fortinet', service: 'Security' },
  { re: /\b(cisco|asa|ios-xe|nexus)\b/i, source: 'Cisco', service: 'Network' },
  { re: /\b(palo\s*alto|pan-os)\b/i, source: 'Palo Alto', service: 'Security' },
  { re: /\b(firewall|iptables|ufw|pf\s+block)\b/i, source: 'Firewall', service: 'Security' },
  { re: /\b(windows\s*server|win32|eventlog|microsoft-windows)\b/i, source: 'Windows Server', service: 'Application' },
  { re: /\b(linux|systemd|syslog|rsyslog|journald)\b/i, source: 'Linux Server', service: 'Monitoring' },
  { re: /\b(nginx)\b/i, source: 'Nginx', service: 'Web Server' },
  { re: /\b(apache|httpd)\b/i, source: 'Apache', service: 'Web Server' },
  { re: /\b(aws|amazon|cloudwatch|ec2|s3|lambda)\b/i, source: 'AWS', service: 'Application' },
  { re: /\b(azure|microsoft\.com\/azure)\b/i, source: 'Azure', service: 'Application' },
  { re: /\b(gcp|google cloud|stackdriver)\b/i, source: 'Google Cloud', service: 'Application' },
  { re: /\b(docker|containerd|kubernetes|k8s|pod)\b/i, source: 'Kubernetes', service: 'Monitoring' },
  { re: /\b(odoo|erp|sap|métier|metier)\b/i, source: 'Application métier', service: 'Application' },
  { re: /\b(mysql|postgres|mongodb|redis|database|sql)\b/i, source: 'Database', service: 'Database' },
  { re: /\b(prometheus|grafana|datadog|zabbix|nagios)\b/i, source: 'Monitoring', service: 'Monitoring' },
];

const FORMAT_SOURCE_MAP = {
  apache: { source: 'Apache', service: 'Web Server' },
  nginx: { source: 'Nginx', service: 'Web Server' },
  syslog: { source: 'Linux Server', service: 'Monitoring' },
  docker: { source: 'Docker', service: 'Monitoring' },
  kubernetes: { source: 'Kubernetes', service: 'Monitoring' },
  java: { source: 'Java Application', service: 'Application' },
  python: { source: 'Python Application', service: 'Application' },
  php: { source: 'PHP Application', service: 'Application' },
  odoo: { source: 'Odoo', service: 'Application' },
};

const EVENT_TYPE_SERVICE_MAP = {
  authentication: 'Authentication',
  auth: 'Authentication',
  database: 'Database',
  database_query: 'Database',
  security: 'Security',
  api: 'Application',
  system: 'Monitoring',
  performance: 'Monitoring',
  cron: 'Application',
  deployment: 'Application',
  exception: 'Application',
  error: 'Application',
};

const MAIN_SERVICE_RULES = [
  { re: /\b(login|logout|auth|token|session|password|jwt|oauth|sso|401|403)\b/i, service: 'Authentication' },
  { re: /\b(sql|mysql|postgres|mongodb|redis|database|query|deadlock)\b/i, service: 'Database' },
  { re: /\b(firewall|blocked|intrusion|xss|csrf|malware|attack|vpn|dns|tcp|udp|network)\b/i, service: 'Network' },
  { re: /\b(nginx|apache|http|https|web\s*server|get\s+\/|post\s+\/)\b/i, service: 'Web Server' },
  { re: /\b(security|certificate|tls|ssl|encrypt|audit)\b/i, service: 'Security' },
  { re: /\b(prometheus|grafana|metric|monitor|health|uptime|alert)\b/i, service: 'Monitoring' },
];

function pickText(log, opts = {}) {
  return [
    log.message,
    log.source,
    log.source_server,
    log.service,
    log.module,
    log.log_source,
    log.parser_format,
    log.log_format,
    opts.filename,
    opts.importSource,
    opts.importService,
  ].filter(Boolean).join(' ');
}

export function detectSourceSystem(log, opts = {}) {
  if (log.source_system) return log.source_system;

  const format = log.parser_format || log.log_format || opts.format;
  if (format && FORMAT_SOURCE_MAP[format]) {
    return FORMAT_SOURCE_MAP[format].source;
  }

  const text = pickText(log, opts);
  for (const rule of SOURCE_RULES) {
    if (rule.re.test(text)) return rule.source;
  }

  if (log.log_source) return String(log.log_source).slice(0, 255);
  if (log.source) return String(log.source).slice(0, 255);
  if (opts.importSource) return String(opts.importSource).slice(0, 255);
  return 'Unknown';
}

export function detectMainService(log, eventType, opts = {}) {
  if (log.main_service) return log.main_service;

  const format = log.parser_format || log.log_format || opts.format;
  if (format && FORMAT_SOURCE_MAP[format]) {
    return FORMAT_SOURCE_MAP[format].service;
  }

  if (eventType && EVENT_TYPE_SERVICE_MAP[eventType]) {
    return EVENT_TYPE_SERVICE_MAP[eventType];
  }

  const text = pickText(log, opts);
  for (const rule of MAIN_SERVICE_RULES) {
    if (rule.re.test(text)) return rule.service;
  }

  if (log.service && log.service !== 'unknown') {
    const svc = String(log.service);
    if (/auth/i.test(svc)) return 'Authentication';
    if (/db|database|sql/i.test(svc)) return 'Database';
    if (/web|http|nginx|apache/i.test(svc)) return 'Web Server';
    if (/net|network/i.test(svc)) return 'Network';
    if (/sec|security/i.test(svc)) return 'Security';
    if (/monitor|metric/i.test(svc)) return 'Monitoring';
    return 'Application';
  }

  return 'Application';
}

export function detectHostname(log, opts = {}) {
  if (log.hostname) return String(log.hostname).slice(0, 255);
  const host = log.source_server || log.host || log.source || opts.importSource || null;
  return host ? String(host).slice(0, 255) : null;
}

export function detectLogOrigin(log, opts = {}) {
  if (log.log_origin) return String(log.log_origin).slice(0, 100);

  const sourceType = opts.source_type || log.source_type;
  if (sourceType === 'import') {
    if (opts.filename || log.file_name) {
      return `import:${opts.filename || log.file_name}`;
    }
    return 'import';
  }
  if (sourceType === 'watch') return opts.filePath ? `watch:${opts.filePath}` : 'watch';
  if (sourceType === 'api') return 'api';
  if (sourceType === 'manual') return 'manual';
  if (log.import_job_id) return `import:${log.file_name || 'file'}`;
  return sourceType || 'unknown';
}

/**
 * Enrich a parsed log entry with canonical metadata fields.
 * Keeps `timestamp` in sync with `event_timestamp` for backward compatibility.
 */
export function enrichLogMetadata(log, opts = {}) {
  const eventType = log.event_type || opts.event_type || 'generic';
  const event_timestamp = log.event_timestamp || log.timestamp || null;
  const source_system = detectSourceSystem(log, opts);
  const main_service = detectMainService(log, eventType, opts);
  const hostname = detectHostname(log, opts);
  const log_origin = detectLogOrigin(log, opts);

  return {
    ...log,
    event_timestamp,
    timestamp: event_timestamp,
    source_system,
    main_service,
    hostname,
    log_origin,
    log_source: log.log_source || source_system,
  };
}

export default {
  detectSourceSystem,
  detectMainService,
  detectHostname,
  detectLogOrigin,
  enrichLogMetadata,
};
