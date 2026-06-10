/**
 * API Client — Centralisé
 * Toutes les requêtes utilisent credentials: 'include' pour les cookies HTTPOnly.
 * Aucun token Bearer / aucun header Authorization / aucun localStorage.
 */

import type {
  AlertQueryParams, LogQueryParams, PurgePayload, AuditLogQueryParams,
} from './api-types';

const fetchApi = async (url: string, options: RequestInit = {}) => {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (res.status === 401) {
    // Rediriger vers login si session expirée
    if (typeof window !== 'undefined' && !window.location.pathname.includes('login')) {
      window.location.reload();
    }
    throw new Error('Session expirée');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : {};
};

const fetchApiNoJson = async (url: string, options: RequestInit = {}) => {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erreur ${res.status}`); }
  return res;
};

export const api = {
  auth: {
    me: () => fetchApi('/api/auth/me'),
    login: (email: string, password: string) => fetchApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => fetchApi('/api/auth/logout', { method: 'POST' }),
    changePassword: (currentPassword: string, newPassword: string) => fetchApi('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  },
  setup: {
    check: () => fetchApi('/api/setup'),
    createAdmin: (data: { email: string; password: string; displayName?: string }) => fetchApi('/api/setup', { method: 'POST', body: JSON.stringify(data) }),
  },
  dashboard: {
    summary: () => fetchApi('/api/dashboard/summary'),
    trends: (days = 7) => fetchApi(`/api/dashboard/trends?days=${days}`),
    today: () => fetchApi('/api/dashboard/today'),
    topErrors: (limit = 5) => fetchApi(`/api/dashboard/top-errors?limit=${limit}`),
    recentLogs: (limit = 10) => fetchApi(`/api/dashboard/recent-logs?limit=${limit}`),
    system: () => fetchApi('/api/dashboard/system'),
  },
  logs: {
    list: (params: LogQueryParams) => {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])));
      return fetchApi(`/api/logs?${q}`);
    },
    exportCsv: (params: LogQueryParams) => api.logs.export.csv(params).then(r => r.blob()),
    exportJson: (params: LogQueryParams) => api.logs.export.json(params).then(r => r.blob()),
    get: (id: string) => fetchApi(`/api/logs/${id}`),
    export: {
      csv: (params: LogQueryParams) => {
        const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])));
        return fetchApiNoJson(`/api/logs/export/csv?${q}`);
      },
      json: (params: LogQueryParams) => {
        const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])));
        return fetchApiNoJson(`/api/logs/export/json?${q}`);
      },
      pdf: (params: LogQueryParams) => {
        const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])));
        return fetchApiNoJson(`/api/logs/export/pdf?${q}`);
      },
    },
  },
  alerts: {
    list: (params?: Record<string, unknown>) => {
      const q = params ? new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))) : '';
      return fetchApi(`/api/alerts${q ? '?' + q : ''}`);
    },
    get: (id: string) => fetchApi(`/api/alerts/${id}`),
    update: (id: string, data: Record<string, unknown>) => fetchApi(`/api/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    readAll: () => fetchApi('/api/alerts/read-all', { method: 'POST' }),
    evaluate: () => fetchApi('/api/alerts/evaluate', { method: 'POST' }),
    getAlerts: (params?: AlertQueryParams) => api.alerts.list(params as Record<string, unknown>),
    updateAlert: (id: string, status: string) => api.alerts.update(id, { status }),
    readAllAlerts: () => api.alerts.readAll(),
    rules: {
      list: () => fetchApi('/api/admin/alert-rules'),
      create: (data: Record<string, unknown>) => fetchApi('/api/admin/alert-rules', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Record<string, unknown>) => fetchApi(`/api/admin/alert-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: string) => fetchApi(`/api/admin/alert-rules/${id}`, { method: 'DELETE' }),
    },
  },
  import: {
    upload: (formData: FormData) => fetch('/api/import/upload', { method: 'POST', credentials: 'include', body: formData }).then(async r => { if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Erreur upload'); } return r.json(); }),
    uploadFile: (file: File, source?: string, service?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (source) formData.append('source', source);
      if (service) formData.append('service', service);
      return api.import.upload(formData);
    },
    jobs: (limit = 10) => fetchApi(`/api/import/jobs?limit=${limit}`),
    getImportJobs: async (_page = 1, limit = 50) => {
      const jobs = await api.import.jobs(limit);
      return { jobs: Array.isArray(jobs) ? jobs : jobs.jobs ?? [] };
    },
    job: (id: string) => fetchApi(`/api/import/jobs/${id}`),
  },
  admin: {
    users: {
      list: () => fetchApi('/api/admin/users'),
      create: (data: Record<string, unknown>) => fetchApi('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Record<string, unknown>) => fetchApi(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: string) => fetchApi(`/api/admin/users/${id}`, { method: 'DELETE' }),
      resetPassword: (id: string, newPassword: string) => fetchApi(`/api/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
    },
    getUsers: () => api.admin.users.list(),
    createUser: (data: Record<string, unknown>) => api.admin.users.create(data),
    updateUser: (id: string, data: Record<string, unknown>) => api.admin.users.update(id, data),
    deleteUser: (id: string) => api.admin.users.delete(id),
    resetUserPassword: (id: string, newPassword: string) => api.admin.users.resetPassword(id, newPassword),
    getAlertRules: () => api.alerts.rules.list(),
    createAlertRule: (data: Record<string, unknown>) => api.alerts.rules.create(normalizeRulePayload(data)),
    updateAlertRule: (id: string, data: Record<string, unknown>) => api.alerts.rules.update(id, normalizeRulePayload(data)),
    deleteAlertRule: (id: string) => api.alerts.rules.delete(id),
    getAuditLogs: (params?: AuditLogQueryParams) => api.admin.audit(params),
    getSystemHealth: () => fetchApi('/api/admin/system-stats'),
    getAnomalies: async (params?: Record<string, unknown>) => {
      const q = params ? new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))) : '';
      const data = await fetchApi(`/api/admin/anomalies${q ? '?' + q : ''}`);
      return Array.isArray(data) ? { anomalies: data, pagination: { total: data.length } } : data;
    },
    runAnomalyDetection: () => fetchApi('/api/admin/anomalies', { method: 'POST' }),
    purgeLogs: (data: PurgePayload) => api.admin.purge(data),
    audit: (params?: AuditLogQueryParams) => {
      const q = params ? new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))) : '';
      return fetchApi(`/api/admin/audit${q ? '?' + q : ''}`);
    },
    anomalies: () => fetchApi('/api/admin/anomalies'),
    purge: (data: PurgePayload) => fetchApi('/api/admin/purge', { method: 'POST', body: JSON.stringify(data) }),
  },
  health: () => fetchApi('/api/health'),
};

export interface SystemHealth {
  totalUsers: number;
  dbSizeMb: number;
  orphanLogs: number;
  watcherRunning: boolean;
  lastOrphanImport: string | null;
  orphanLogsAgeMinutes: number | null;
  activeWatchers: number;
  unmappedWatchDirectories: number;
  redisConnected: boolean;
  databaseConnected: boolean;
  totalLogs: number;
  openErrorGroups: number;
  watchedFiles: number;
  inflightProcesses: number;
  watcherErrors24h?: number; // Optional, as it's a placeholder for now
}

function normalizeRulePayload(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  if ('enabled' in copy && !('isActive' in copy)) {
    copy.isActive = Boolean(copy.enabled);
    delete copy.enabled;
  }
  return copy;
}

export type { AuthUser } from '@/stores/auth-store';
export type {
  DashboardSummary, DashboardTrends, DashboardTopErrors, DashboardRecentLogs,
  DashboardToday, DashboardSystem, LogEntry, LogQueryParams, LogListResponse,
  AlertItem, AlertRule, AlertQueryParams, AlertListResponse, CreateAlertRulePayload,
  ImportJob, ImportJobsResponse, AuditLogEntry, AuditLogQueryParams, AuditLogResponse,
  AnomalyItem, AnomalyListResponse, AdminUser, CreateUserPayload, UpdateUserPayload,
  PurgePayload, SetupStatus,
} from './api-types';
