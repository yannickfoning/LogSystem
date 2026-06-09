export interface DashboardSummary { totalLogs: number; totalErrors?: number; totalAlerts?: number; totalUsers?: number; userCount?: number; unreadAlerts: number; todayCount?: number; todayLogs?: number; infoCount?: number; warningCount?: number; errorCount?: number; fatalCount?: number; criticalCount?: number; levelsBreakdown?: Record<string, number>; }
export interface DashboardTrends { trends: Array<{ date: string; count: number; errorCount: number }> }
export interface DashboardTopErrors { topErrors?: Array<Record<string, unknown>>; errors?: Array<Record<string, unknown>> }
export interface DashboardRecentLogs { logs?: LogEntry[]; recentLogs?: LogEntry[] }
export interface DashboardToday { count?: number; logs?: LogEntry[] }
export interface DashboardSystem {
  system: {
    uptime?: number;
    totalLogs?: number;
    dbSize?: string;
    lastImport?: string;
    activeUsers?: number;
    [key: string]: unknown;
  };
  uptime?: number;
  memory?: Record<string, number>;
  cpu?: Record<string, number>;
  disk?: Record<string, number>;
}

export interface LogEntry { id: string; timestamp: string; createdAt?: string; logLevel: string; level?: string; source?: string; service?: string; message: string; errorType?: string; eventType?: string; clientIp?: string; targetUser?: string; module?: string; fingerprint?: string; metadata?: unknown; importDate?: string; importTimeOnly?: string; createdAtLog?: string; createdTimeLog?: string; importedAt?: string; importedTime?: string; importedByEmail?: string; importIp?: string; responsibleUsername?: string; sourceDirectory?: string; sourceApplication?: string; fileName?: string; parserFormat?: string; }

export interface LogQueryParams {
  [key: string]: unknown;
  page?: number; limit?: number; level?: string; logLevel?: string; source?: string; service?: string; application?: string; directory?: string; search?: string; keyword?: string; dateFrom?: string; dateTo?: string; startDate?: string; endDate?: string; timeFrom?: string; timeTo?: string;
}

export interface LogListResponse { logs: LogEntry[]; pagination: { page: number; limit: number; total: number; totalPages: number } }

export interface AlertItem {
  id: string;
  type: string;
  alertType?: string;
  severity: string;
  message: string;
  status: string;
  source?: string;
  occurrenceCount?: number;
  firstOccurrence?: string;
  lastOccurrence?: string;
  errorType?: string;
  sourceDirectory?: string;
  affectedUser?: string;
  createdAt: string;
  ruleId?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  condition: string;
  threshold: number;
  timeframe: number;
  enabled: boolean;
  conditionType?: string;
  conditionValue?: string;
  thresholdValue?: number | null;
  timeWindowMinutes?: number;
  severity: string;
  cooldownMinutes?: number;
  isActive?: boolean;
}

export interface AlertQueryParams { page?: number; limit?: number; status?: string; severity?: string; }
export interface AlertListResponse { alerts: AlertItem[]; pagination: { page: number; limit: number; total: number; totalPages: number } }

export interface CreateAlertRulePayload {
  [key: string]: unknown;
  name: string; description?: string; condition?: string; threshold?: number; timeframe?: number; conditionType?: string; conditionValue?: string; thresholdValue?: number | null; timeWindowMinutes?: number; severity: string; cooldownMinutes?: number; isActive?: boolean; enabled?: boolean;
}

export interface ImportJob {
  originalName: string;
  id: string;
  filename?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalLines: number;
  processedLines: number;
  importedLines: number;
  errorCount: number;
  skippedLines: number;
  importSummary?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ImportJobsResponse { jobs: ImportJob[] }

export interface AuditLogEntry {
  id: string;
  userEmail?: string;
  userId?: string;
  action: string;
  resource?: string;
  resourceType?: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
  status?: string;
  createdAt: string;
}

export interface AuditLogQueryParams { page?: number; limit?: number; action?: string; }
export interface AuditLogResponse { logs?: AuditLogEntry[]; auditLogs?: AuditLogEntry[]; pagination: { page: number; limit: number; total: number; totalPages: number } }

export interface AnomalyItem { id: string; type: string; severity: string; message: string; description?: string; source?: string; resolved?: boolean; metadata?: string; detectedAt: string; }
export interface AnomalyListResponse { anomalies: AnomalyItem[]; pagination?: { total: number } }

export interface AdminUser { id: string; email: string; displayName: string; role: string; isActive: boolean; lastLogin?: string; lastIp?: string; createdAt: string; }
export interface CreateUserPayload { email: string; password: string; displayName?: string; role: string; }
export interface UpdateUserPayload { email?: string; displayName?: string; role?: string; isActive?: boolean; }

export interface PurgePayload {
  [key: string]: unknown;
  level?: string; startDate?: string; endDate?: string; olderThanDays?: number;
}

export interface SetupStatus { needsSetup: boolean; userCount?: number; }