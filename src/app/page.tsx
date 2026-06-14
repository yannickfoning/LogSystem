'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, Upload, Bell, Shield, LogOut, Sun, Moon,
  ChevronDown, ChevronRight, Search, RefreshCw, Download, Trash2, Plus,
  Eye, CheckCircle, XCircle, AlertTriangle, Activity, Server, Users,
  Loader2, Settings, FileBarChart, Clock, Filter, X, Menu,
  UserPlus, Key, ToggleLeft, ToggleRight, Play, Zap, FolderOpen, Bug,
  Info, AlertOctagon, Skull, Stethoscope, ClipboardList, ArrowUpDown,
  ChevronLeft, ChevronRightIcon, MoreHorizontal, BellRing, Archive
} from 'lucide-react';
import {
  PieChart, Pie, Cell, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts';

import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';
import type {
  AuthUser, DashboardSummary, DashboardTrends, DashboardTopErrors, SystemHealth,
  DashboardRecentLogs, DashboardToday, DashboardSystem,
  LogEntry, LogQueryParams, LogListResponse,
  AlertItem, AlertRule, AlertQueryParams, AlertListResponse, CreateAlertRulePayload,
  ImportJob, ImportJobsResponse,
  AuditLogEntry, AuditLogQueryParams, AuditLogResponse,
  AnomalyItem, AnomalyListResponse,
  AdminUser, CreateUserPayload, UpdateUserPayload, PurgePayload,
  SetupStatus,
} from '@/lib/api-client';

import {
  SidebarProvider, Sidebar, SidebarContent, SidebarHeader,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarFooter, SidebarTrigger, SidebarInset,
} from '@/components/ui/sidebar';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

// ─── Constants ───────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '#94a3b8',
  INFO: '#10b981',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  CRITICAL: '#a855f7',
  FATAL: '#881337',
};

const LEVEL_BG: Record<string, string> = {
  DEBUG: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  INFO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  WARNING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CRITICAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  FATAL: 'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
};

const SOURCE_STYLES: Record<string, string> = {
  watch: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
  import: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
  api: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800',
  manual: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#a855f7',
};

type TabKey = 'dashboard' | 'weblog' | 'import' | 'alerts' | 'admin';

const NAV_ITEMS: { key: TabKey; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { key: 'weblog', label: 'Logs & Recherche', icon: Search },
  { key: 'import', label: 'Import', icon: Upload },
  { key: 'alerts', label: 'Alertes', icon: Bell },
  { key: 'admin', label: 'Administration', icon: Shield, adminOnly: true },
];

// ─── Helpers ─────────────────────────────────────────────────

function getSeverityStyles(severity: string) {
  const styles: Record<string, string> = {
    low: 'bg-emerald-500/20 text-emerald-500',
    medium: 'bg-amber-500/20 text-amber-500',
    high: 'bg-red-500/20 text-red-500',
    critical: 'bg-purple-500/20 text-purple-500',
  };
  return styles[severity] || 'bg-slate-500/20 text-slate-500';
}

function getStatColorClass(color: string) {
  const map: Record<string, string> = {
    '#6366f1': 'bg-indigo-500/20 text-indigo-500',
    '#10b981': 'bg-emerald-500/20 text-emerald-500',
    '#ef4444': 'bg-red-500/20 text-red-500',
    '#881337': 'bg-rose-900/20 text-rose-700',
    '#f59e0b': 'bg-amber-500/20 text-amber-500',
  };
  return map[color] || 'bg-slate-500/20 text-slate-500';
}

function formatDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR');
}

function formatShortDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ═══════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════

function LoginScreen() {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    api.setup.check()
      .then((data: SetupStatus) => {
        setNeedsSetup(data.needsSetup);
        setChecking(false);
      })
      .catch(() => {
        setChecking(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (needsSetup) {
        await api.setup.createAdmin({ email, password, displayName });
      }
      await login(email, password);
      toast.success('Connexion réussie');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-xl border-border/50">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <Activity className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {needsSetup ? 'Configuration initiale' : 'LogSystem'}
            </CardTitle>
            <CardDescription>
              {needsSetup
                ? 'Créez le compte administrateur pour commencer'
                : 'Plateforme de gestion et d\'analyse des logs'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {needsSetup && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Nom complet</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Administrateur"
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-destructive text-center"
                >
                  {error}
                </motion.p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {needsSetup ? 'Créer le compte admin' : 'Se connecter'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════

function StatCard({
  title, value, icon: Icon, color, subtitle,
}: {
  title: string; value: number | string; icon: React.ElementType;
  color: string; subtitle?: string; // color used as key for Tailwind mapping
}) {
  const colorClass = getStatColorClass(color);
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorClass.split(' ')[0]}`}>
            <Icon className={`h-5 w-5 ${colorClass.split(' ')[1]}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════

function DashboardView() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [topErrors, setTopErrors] = useState<DashboardTopErrors | null>(null);
  const [recentLogs, setRecentLogs] = useState<DashboardRecentLogs | null>(null);
  const [system, setSystem] = useState<DashboardSystem | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, te, rl, sys] = await Promise.allSettled([
        api.dashboard.summary(),
        api.dashboard.trends(7),
        api.dashboard.topErrors(10),
        api.dashboard.recentLogs(10),
        api.dashboard.system(),
      ]);
      if (s.status === 'fulfilled') setSummary(s.value);
      if (t.status === 'fulfilled') setTrends(t.value);
      if (te.status === 'fulfilled') setTopErrors(te.value);
      if (rl.status === 'fulfilled') setRecentLogs(rl.value);
      if (sys.status === 'fulfilled') setSystem(sys.value);
    } catch {
      /* silently handle */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Pie chart data
  const pieData = summary
    ? [
        { name: 'INFO', value: summary.infoCount, color: LEVEL_COLORS.INFO },
        { name: 'WARNING', value: summary.warningCount, color: LEVEL_COLORS.WARNING },
        { name: 'ERROR', value: summary.errorCount, color: LEVEL_COLORS.ERROR },
        { name: 'FATAL', value: summary.fatalCount, color: LEVEL_COLORS.FATAL },
      ].filter((d) => (d.value ?? 0) > 0)
    : [];

  // Line chart data — use t.count and t.errorCount directly
  const lineData = trends?.trends.map((t) => ({
    date: formatShortDate(t.date),
    total: t.count,
    erreurs: t.errorCount,
  })) ?? [];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Logs" value={summary?.totalLogs ?? 0} icon={FileBarChart} color="#6366f1" />
        <StatCard title="Aujourd'hui" value={summary?.todayCount ?? 0} icon={Clock} color="#10b981" />
        <StatCard title="Erreurs" value={summary?.errorCount ?? 0} icon={AlertTriangle} color="#ef4444" />
        <StatCard title="Fatals" value={summary?.fatalCount ?? 0} icon={Skull} color="#881337" />
        <StatCard title="Alertes non lues" value={summary?.unreadAlerts ?? 0} icon={BellRing} color="#f59e0b" />
        <StatCard title="INFO" value={summary?.infoCount ?? 0} icon={Info} color="#10b981" />
        <StatCard title="WARNING" value={summary?.warningCount ?? 0} icon={AlertOctagon} color="#f59e0b" />
        <StatCard title="Utilisateurs" value={summary?.userCount ?? 0} icon={Users} color="#6366f1" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie Chart — Severity Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribution par sévérité</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Aucune donnée</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Line Chart — 7-day Trends */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tendances sur 7 jours</CardTitle>
          </CardHeader>
          <CardContent>
            {lineData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Aucune donnée</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} />
                  <RechartsTooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} name="Total" dot={false} />
                  <Line type="monotone" dataKey="erreurs" stroke="#ef4444" strokeWidth={2} name="Erreurs" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Error Groups & System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Error Groups — use topErrors.topErrors NOT topErrors.errorGroups */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Groupes d'erreurs principaux</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-72">
              {topErrors?.topErrors?.length ? (
                <div className="space-y-3">
                  {topErrors.topErrors.map((eg, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50">
                      <Badge variant="destructive" className="shrink-0 mt-0.5">{String(eg.count ?? 0)}</Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{String(eg.message ?? '')}</p>
                        <p className="text-xs text-muted-foreground">{String(eg.source ?? '')} · {eg.lastSeen ? formatDate(String(eg.lastSeen)) : 'N/A'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Aucune erreur</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* System Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">État du système</CardTitle>
          </CardHeader>
          <CardContent>
            {system?.system ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Uptime</span>
                  <span className="font-medium">{formatUptime(system.system.uptime ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total logs</span>
                  <span className="font-medium">{system.system.totalLogs?.toLocaleString('fr-FR') ?? '0'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Taille DB</span>
                  <span className="font-medium">{system.system.dbSize ?? '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Dernier import</span>
                  <span className="font-medium">{system.system.lastImport ? formatDate(system.system.lastImport) : 'Aucun'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Utilisateurs actifs</span>
                  <span className="font-medium">{system.system.activeUsers ?? 0}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Données non disponibles</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Logs Table — use recentLogs.recentLogs NOT recentLogs.logs */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Logs récents</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-1" /> Actualiser
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-80">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Horodatage</TableHead>
                  <TableHead className="w-24">Niveau</TableHead>
                  <TableHead className="w-24">Provenance</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLogs?.recentLogs?.length ? (
                  recentLogs.recentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs font-mono">{formatDate(log.timestamp)}</TableCell>
                      <TableCell>
                        <Badge className={LEVEL_BG[log.logLevel] ?? 'bg-gray-100 text-gray-700'} variant="secondary">
                          {log.logLevel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={SOURCE_STYLES[log.sourceType || 'watch']}>{log.sourceType?.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.source}</TableCell>
                      <TableCell className="text-sm max-w-xs truncate">{log.message}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Aucun log récent
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WEBLOG VIEW
// ═══════════════════════════════════════════════════════════════

function WebLogView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 100, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters — use `level` NOT `logLevel`
  const [levelFilter, setLevelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState('');
  const [realtimeMode, setRealtimeMode] = useState(false);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: LogQueryParams = {
        page,
        limit: 100,
        level: levelFilter || undefined,
        source: sourceFilter || undefined,
        application: serviceFilter || undefined,
        directory: directoryFilter || undefined,
        search: searchFilter || undefined,
        dateFrom: startDate || undefined,
        dateTo: endDate || undefined,
        timeFrom: timeFrom || undefined,
        timeTo: timeTo || undefined,
        realtime: realtimeMode || undefined,
      };
      const data = await api.logs.list(params);
      setLogs(data.logs);
      setPagination(data.pagination ?? { page: 1, limit: 100, total: 0, totalPages: 0 });
    } catch {
      toast.error('Erreur lors du chargement des logs');
    } finally {
      setLoading(false);
    }
  }, [levelFilter, sourceFilter, serviceFilter, directoryFilter, searchFilter, startDate, endDate, timeFrom, timeTo, realtimeMode]);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const params: LogQueryParams = {
        level: levelFilter || undefined,
        source: sourceFilter || undefined,
        application: serviceFilter || undefined,
        directory: directoryFilter || undefined,
        search: searchFilter || undefined,
        dateFrom: startDate || undefined,
        dateTo: endDate || undefined,
        timeFrom: timeFrom || undefined,
        timeTo: timeTo || undefined,
      };
      const blob = format === 'csv'
        ? await api.logs.exportCsv(params)
        : await api.logs.exportJson(params);
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Export ${format.toUpperCase()} téléchargé`);
    } catch {
      toast.error("Erreur lors de l'export");
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-3">
            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v === 'ALL' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Niveau" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous</SelectItem>
                {Object.keys(LEVEL_COLORS).map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} />
            <Input placeholder="Application" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} />
            <Input placeholder="RÃ©pertoire" value={directoryFilter} onChange={(e) => setDirectoryFilter(e.target.value)} />
            <Input placeholder="Mot-clÃ©..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} />
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
            <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </div>
          <div className="flex flex-col min-[480px]:flex-row min-[480px]:items-center gap-4 mt-3">
            <Button size="sm" onClick={() => fetchLogs(1)}>
              <Search className="h-4 w-4 mr-1" /> Rechercher
            </Button>
            <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-md border">
              <Switch 
                checked={realtimeMode} 
                onCheckedChange={setRealtimeMode} 
                id="realtime-mode"
              />
              <Label htmlFor="realtime-mode" className="text-xs font-medium cursor-pointer">Mode SOC (Live uniquement)</Label>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setLevelFilter(''); setSourceFilter(''); setServiceFilter(''); setDirectoryFilter(''); setSearchFilter(''); setStartDate(''); setEndDate(''); setTimeFrom(''); setTimeTo(''); setRealtimeMode(false); }}>
              <X className="h-4 w-4 mr-1" /> Réinitialiser
            </Button>
            <div className="min-[480px]:ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleExport('csv')}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleExport('json')}>
                <Download className="h-4 w-4 mr-1" /> JSON
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[calc(100vh-320px)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Horodatage</TableHead>
                  <TableHead className="w-24">Niveau</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Aucun log trouvé
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <React.Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      >
                        <TableCell className="text-xs font-mono">{formatDate(log.timestamp)}</TableCell>
                        <TableCell>
                          <Badge className={LEVEL_BG[log.logLevel] ?? ''} variant="secondary">{log.logLevel}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.source}</TableCell>
                        <TableCell className="text-sm max-w-md truncate">{log.message}</TableCell>
                        <TableCell>
                          {expandedId === log.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                      </TableRow>
                      {expandedId === log.id && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/30 p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground uppercase font-semibold">Temporalité SIEM</p>
                                <div><span className="font-medium text-amber-600 dark:text-amber-400">Événement :</span> {formatDate(log.createdAtLog || log.timestamp)}</div>
                                <div><span className="font-medium text-blue-600 dark:text-blue-400">Ingestion :</span> {formatDate(log.importedAt || log.createdAt || '')}</div>
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground uppercase font-semibold">Origine & Format</p>
                              <div><span className="font-medium">ID:</span> {log.id}</div>
                              <div><span className="font-medium">Service:</span> {log.service || '—'}</div>
                              <div><span className="font-medium">Format:</span> <Badge variant="outline" className="text-[10px] h-4">{log.parserFormat || 'raw'}</Badge></div>
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground uppercase font-semibold">Fichier Source</p>
                                <div className="truncate"><span className="font-medium">Nom:</span> {log.fileName || '—'}</div>
                                <div className="truncate"><span className="font-medium">Chemin:</span> {log.sourceDirectory || '—'}</div>
                              </div>
                              {log.metadata != null && typeof log.metadata === 'object' ? (
                                <div className="col-span-full">
                                  <span className="font-medium">Métadonnées:</span>
                                  <pre className="mt-1 text-xs bg-background p-2 rounded overflow-auto max-h-40">
                                    {JSON.stringify(log.metadata, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex flex-col min-[480px]:flex-row min-[480px]:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {pagination.total > 0 && pagination.totalPages > 0
            ? `Page ${pagination.page} sur ${pagination.totalPages} (${(pagination.page - 1) * pagination.limit + 1}-${Math.min(pagination.page * pagination.limit, pagination.total)} sur ${pagination.total})`
            : 'Aucun résultat'}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm" variant="outline"
            disabled={pagination.page <= 1}
            onClick={() => fetchLogs(pagination.page - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchLogs(pagination.page + 1)}
          >
            Suivant <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT VIEW
// ═══════════════════════════════════════════════════════════════

function ImportView() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [source, setSource] = useState('');
  const [service, setService] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_TEXT = '.txt,.log,.json,.jsonl,.csv,.xml';
  const ACCEPTED_ARCHIVES = '.zip,.rar,.7z,.tar,.gz,.tar.gz';
  const ACCEPTED = `${ACCEPTED_TEXT},${ACCEPTED_ARCHIVES}`;

  const fetchJobs = useCallback(async () => {
    try {
      const data = await api.import.getImportJobs(1, 50);
      setJobs(data.jobs ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        await api.import.uploadFile(files[i], source || undefined, service || undefined);
      }
      toast.success('Fichier(s) importé(s) avec succès');
      setSource('');
      setService('');
      fetchJobs();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'import");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleUpload(e.dataTransfer.files);
  };

  const statusBadge = (status: ImportJob['status']) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
      processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    };
    const labels: Record<string, string> = { pending: 'En attente', processing: 'Traitement', completed: 'Terminé', failed: 'Échoué' };
    return <Badge className={map[status] ?? ''} variant="secondary">{labels[status] ?? status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importer des fichiers de logs</CardTitle>
          <CardDescription>
            Formats texte : txt, log, json, jsonl, csv, xml · Archives : zip, rar, 7z, tar, gz, tar.gz
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Source</Label>
              <Input placeholder="ex: production" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Service</Label>
              <Input placeholder="ex: api-gateway" value={service} onChange={(e) => setService(e.target.value)} />
            </div>
          </div>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Import en cours...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Glissez-déposez vos fichiers ici</p>
                <p className="text-xs text-muted-foreground">ou cliquez pour sélectionner</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
              aria-label="Upload log files"
              title="Select log files to import"
            />
          </div>
        </CardContent>
      </Card>

      {/* Import Jobs list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Historique des imports</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchJobs}>
              <RefreshCw className="h-4 w-4 mr-1" /> Actualiser
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fichier</TableHead>
                  <TableHead className="w-28">Statut</TableHead>
                  <TableHead className="w-24">Lignes</TableHead>
                  <TableHead className="w-24">Importées</TableHead>
                  <TableHead className="w-24">Ignorées</TableHead>
                  <TableHead className="w-40">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : jobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Aucun import
                    </TableCell>
                  </TableRow>
                ) : (
                  jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="text-sm font-medium">{job.originalName}</TableCell>
                      <TableCell>{statusBadge(job.status)}</TableCell>
                      <TableCell className="text-sm">{job.total_lines || job.totalLines}</TableCell>
                      <TableCell className="text-sm text-green-600">{job.processed_lines || job.processedLines}</TableCell>
                      <TableCell className="text-sm text-amber-600">{job.skipped_lines || job.skippedLines}</TableCell>
                      <TableCell className="text-xs">{formatDate(job.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ALERTS VIEW
// ═══════════════════════════════════════════════════════════════

function AlertsView() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  const fetchAlerts = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params: AlertQueryParams = {
        page: p,
        limit: 20,
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
      };
      const data = await api.alerts.getAlerts(params);
      setAlerts(data.alerts ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error('Erreur lors du chargement des alertes');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter]);

  useEffect(() => { fetchAlerts(1); }, [fetchAlerts]);

  const handleUpdateAlert = async (id: string, status: string) => {
    try {
      await api.alerts.updateAlert(id, status);
      toast.success('Alerte mise à jour');
      fetchAlerts(page);
    } catch {
      toast.error("Erreur lors de la mise à jour de l'alerte");
    }
  };

  // Dismiss should updateAlert(id, 'closed') NOT deleteAlert(id)
  const handleDismiss = async (id: string) => {
    await handleUpdateAlert(id, 'closed');
  };

  const handleReadAll = async () => {
    try {
      await api.alerts.readAllAlerts();
      toast.success('Toutes les alertes marquées comme lues');
      fetchAlerts(1);
    } catch {
      toast.error('Erreur lors du marquage des alertes');
    }
  };

  const statusLabel: Record<string, string> = {
    active: 'Active',
    acknowledged: 'Reconnue',
    resolved: 'Résolue',
    closed: 'Fermée',
  };
  const statusBg: Record<string, string> = {
    active: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    acknowledged: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    resolved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    closed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="acknowledged">Reconnue</SelectItem>
                <SelectItem value="resolved">Résolue</SelectItem>
                <SelectItem value="closed">Fermée</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v === 'ALL' ? '' : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Sévérité" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toutes</SelectItem>
                <SelectItem value="low">Basse</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="critical">Critique</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => fetchAlerts(1)}>
              <Search className="h-4 w-4 mr-1" /> Filtrer
            </Button>
            <Button size="sm" variant="outline" onClick={handleReadAll} className="ml-auto">
              <CheckCircle className="h-4 w-4 mr-1" /> Tout marquer comme lu
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Alert cards */}
      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Aucune alerte trouvée</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {alerts.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline">{alert.type}</Badge>
                        <Badge
                          className={getSeverityStyles(alert.severity)}
                          variant="secondary"
                        >
                          {alert.severity}
                        </Badge>
                        <Badge className={statusBg[alert.status] ?? ''} variant="secondary">
                          {statusLabel[alert.status] ?? alert.status}
                        </Badge>
                      </div>
                      <p className="text-sm mt-1">{alert.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {alert.source && <span>{alert.source} · </span>}
                        {formatDate(alert.createdAt)}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {alert.status === 'active' && (
                        <Tooltip><TooltipTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => handleUpdateAlert(alert.id, 'acknowledged')}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Reconnaître</TooltipContent></Tooltip>
                      )}
                      {(alert.status === 'active' || alert.status === 'acknowledged') && (
                        <Tooltip><TooltipTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => handleUpdateAlert(alert.id, 'resolved')}>
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Résoudre</TooltipContent></Tooltip>
                      )}
                      {alert.status !== 'closed' && (
                        <Tooltip><TooltipTrigger asChild>
                          <Button size="sm" variant="ghost" onClick={() => handleDismiss(alert.id)}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Fermer</TooltipContent></Tooltip>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} alerte(s) au total</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => fetchAlerts(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => fetchAlerts(page + 1)}>
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADMIN VIEW
// ═══════════════════════════════════════════════════════════════

function AdminView() {
  const [subTab, setSubTab] = useState('users');

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" /> Utilisateurs</TabsTrigger>
          <TabsTrigger value="rules"><Settings className="h-4 w-4 mr-1" /> Règles d'alerte</TabsTrigger>
          <TabsTrigger value="audit"><ClipboardList className="h-4 w-4 mr-1" /> Piste d'audit</TabsTrigger>
          <TabsTrigger value="anomalies"><Bug className="h-4 w-4 mr-1" /> Anomalies</TabsTrigger>
          <TabsTrigger value="purge"><Archive className="h-4 w-4 mr-1" /> Purge</TabsTrigger>
          <TabsTrigger value="system-health"><Stethoscope className="h-4 w-4 mr-1" /> Santé Système</TabsTrigger>
        </TabsList>

        <TabsContent value="users"><AdminUsersTab /></TabsContent>
        <TabsContent value="rules"><AdminAlertRulesTab /></TabsContent>
        <TabsContent value="audit"><AdminAuditTab /></TabsContent>
        <TabsContent value="anomalies"><AdminAnomaliesTab /></TabsContent>
        <TabsContent value="purge"><AdminPurgeTab /></TabsContent>
        <TabsContent value="system-health"><AdminSystemHealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Admin: Users Tab ────────────────────────────────────────

function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [resetPwdUser, setResetPwdUser] = useState<AdminUser | null>(null);

  // Create form
  const [newEmail, setNewEmail] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');

  // Edit form
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');

  // Reset password form
  const [newResetPwd, setNewResetPwd] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.getUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async () => {
    try {
      await api.admin.createUser({ email: newEmail, password: newPwd, displayName: newName, role: newRole });
      toast.success('Utilisateur créé');
      setShowCreate(false);
      setNewEmail(''); setNewPwd(''); setNewName(''); setNewRole('user');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleEdit = async () => {
    if (!editUser) return;
    try {
      await api.admin.updateUser(editUser.id, { displayName: editName, email: editEmail, role: editRole });
      toast.success('Utilisateur mis à jour');
      setEditUser(null);
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.admin.deleteUser(id);
      toast.success('Utilisateur supprimé');
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleResetPwd = async () => {
    if (!resetPwdUser) return;
    try {
      await api.admin.resetUserPassword(resetPwdUser.id, newResetPwd);
      toast.success('Mot de passe réinitialisé');
      setResetPwdUser(null);
      setNewResetPwd('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const openEdit = (u: AdminUser) => {
    setEditName(u.displayName); setEditEmail(u.email); setEditRole(u.role as 'admin' | 'user');
    setEditUser(u);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Gestion des utilisateurs</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nouvel utilisateur
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Aucun utilisateur</TableCell></TableRow>
              ) : users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell className="text-sm">{u.displayName}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(u.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Tooltip><TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(u)}>
                          <Settings className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger><TooltipContent>Modifier</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setResetPwdUser(u); setNewResetPwd(''); }}>
                          <Key className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger><TooltipContent>Réinitialiser MDP</TooltipContent></Tooltip>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Supprimer cet utilisateur ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Cette action est irréversible. L&apos;utilisateur {u.email} sera définitivement supprimé.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(u.id)}>Supprimer</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create user dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvel utilisateur</DialogTitle>
            <DialogDescription>Créer un nouveau compte utilisateur</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Email</Label><Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>Nom complet</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
            <div className="space-y-1"><Label>Mot de passe</Label><Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Rôle</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as 'admin' | 'user')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Utilisateur</SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user dialog */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l&apos;utilisateur</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Email</Label><Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>Nom complet</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Rôle</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as 'admin' | 'user')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Utilisateur</SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Annuler</Button>
            <Button onClick={handleEdit}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetPwdUser} onOpenChange={(v) => { if (!v) { setResetPwdUser(null); setNewResetPwd(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
            <DialogDescription>
              Nouveau mot de passe pour {resetPwdUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Nouveau mot de passe</Label><Input type="password" value={newResetPwd} onChange={(e) => setNewResetPwd(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPwdUser(null); setNewResetPwd(''); }}>Annuler</Button>
            <Button onClick={handleResetPwd}>Réinitialiser</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Admin: Alert Rules Tab ──────────────────────────────────

function AdminAlertRulesTab() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<AlertRule | null>(null);

  // Create / edit form
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleCondition, setRuleCondition] = useState('');
  const [ruleThreshold, setRuleThreshold] = useState(10);
  const [ruleTimeframe, setRuleTimeframe] = useState(300);
  const [ruleSeverity, setRuleSeverity] = useState('high');
  const [ruleEnabled, setRuleEnabled] = useState(true);

  const resetForm = () => {
    setRuleName(''); setRuleDesc(''); setRuleCondition('');
    setRuleThreshold(10); setRuleTimeframe(300); setRuleSeverity('high'); setRuleEnabled(true);
  };

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.getAlertRules();
      setRules(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Erreur lors du chargement des règles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleCreate = async () => {
    try {
      await api.admin.createAlertRule({
        name: ruleName, description: ruleDesc || undefined,
        condition: ruleCondition, threshold: ruleThreshold,
        timeframe: ruleTimeframe, severity: ruleSeverity, enabled: ruleEnabled,
      });
      toast.success('Règle créée');
      setShowCreate(false);
      resetForm();
      fetchRules();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleEdit = async () => {
    if (!editRule) return;
    try {
      await api.admin.updateAlertRule(editRule.id, {
        name: ruleName, description: ruleDesc || undefined,
        condition: ruleCondition, threshold: ruleThreshold,
        timeframe: ruleTimeframe, severity: ruleSeverity, enabled: ruleEnabled,
      });
      toast.success('Règle mise à jour');
      setEditRule(null);
      resetForm();
      fetchRules();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleToggle = async (rule: AlertRule) => {
    try {
      await api.admin.updateAlertRule(rule.id, { enabled: !rule.enabled });
      toast.success(rule.enabled ? 'Règle désactivée' : 'Règle activée');
      fetchRules();
    } catch {
      toast.error('Erreur');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.admin.deleteAlertRule(id);
      toast.success('Règle supprimée');
      fetchRules();
    } catch {
      toast.error('Erreur');
    }
  };

  const openEdit = (r: AlertRule) => {
    setRuleName(r.name); setRuleDesc(r.description ?? '');
    setRuleCondition(r.condition); setRuleThreshold(r.threshold);
    setRuleTimeframe(r.timeframe); setRuleSeverity(r.severity);
    setRuleEnabled(r.enabled);
    setEditRule(r);
  };

  const RuleForm = ({ onSave, saveLabel }: { onSave: () => void; saveLabel: string }): React.ReactElement => (
    <div className="space-y-3">
      <div className="space-y-1"><Label>Nom</Label><Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} /></div>
      <div className="space-y-1"><Label>Description</Label><Textarea value={ruleDesc} onChange={(e) => setRuleDesc(e.target.value)} /></div>
      <div className="space-y-1"><Label>Condition</Label><Input value={ruleCondition} onChange={(e) => setRuleCondition(e.target.value)} placeholder="ex: level=ERROR" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Seuil</Label><Input type="number" value={ruleThreshold} onChange={(e) => setRuleThreshold(Number(e.target.value))} /></div>
        <div className="space-y-1"><Label>Fenêtre (s)</Label><Input type="number" value={ruleTimeframe} onChange={(e) => setRuleTimeframe(Number(e.target.value))} /></div>
      </div>
      <div className="space-y-1">
        <Label>Sévérité</Label>
        <Select value={ruleSeverity} onValueChange={setRuleSeverity}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Basse</SelectItem>
            <SelectItem value="medium">Moyenne</SelectItem>
            <SelectItem value="high">Haute</SelectItem>
            <SelectItem value="critical">Critique</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={ruleEnabled} onCheckedChange={setRuleEnabled} />
        <Label>Activée</Label>
      </div>
      <DialogFooter>
        <Button onClick={onSave}>{saveLabel}</Button>
      </DialogFooter>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Règles d&apos;alerte</CardTitle>
          <Button size="sm" onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nouvelle règle
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : rules.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Aucune règle d&apos;alerte</p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{rule.name}</span>
                    <Badge
                      className={getSeverityStyles(rule.severity)}
                      variant="secondary"
                    >
                      {rule.severity}
                    </Badge>
                    <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                      {rule.enabled ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rule.condition} · Seuil: {rule.threshold} · Fenêtre: {rule.timeframe}s
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Tooltip><TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggle(rule)}>
                      {rule.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger><TooltipContent>{rule.enabled ? 'Désactiver' : 'Activer'}</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(rule)}>
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger><TooltipContent>Modifier</TooltipContent></Tooltip>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer cette règle ?</AlertDialogTitle>
                        <AlertDialogDescription>La règle &quot;{rule.name}&quot; sera définitivement supprimée.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(rule.id)}>Supprimer</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create rule dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle règle d&apos;alerte</DialogTitle>
          </DialogHeader>
          <RuleForm onSave={handleCreate} saveLabel="Créer" />
        </DialogContent>
      </Dialog>

      {/* Edit rule dialog */}
      <Dialog open={!!editRule} onOpenChange={(v) => { if (!v) { setEditRule(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la règle</DialogTitle>
          </DialogHeader>
          <RuleForm onSave={handleEdit} saveLabel="Enregistrer" />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Admin: Audit Trail Tab ──────────────────────────────────

function AdminAuditTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await api.admin.getAuditLogs({ page: p, limit: 20 });
      setLogs(data.logs ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error('Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Piste d&apos;audit</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => fetchLogs(page)}>
            <RefreshCw className="h-4 w-4 mr-1" /> Actualiser
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-96">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Ressource</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Détails</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Aucune entrée</TableCell></TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs">{formatDate(log.createdAt)}</TableCell>
                    <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                    <TableCell className="text-sm">{log.resource}</TableCell>
                    <TableCell className="text-sm">{log.userEmail ?? log.userId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{log.details ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        {total > 20 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">{total} entrée(s)</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => fetchLogs(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => fetchLogs(page + 1)}>
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin: Anomalies Tab ────────────────────────────────────

function AdminAnomaliesTab() {
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);

  const fetchAnomalies = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await api.admin.getAnomalies({ page: p, limit: 20 });
      setAnomalies(data.anomalies ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error('Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnomalies(1); }, [fetchAnomalies]);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await api.admin.runAnomalyDetection();
      toast.success(`${result.anomaliesFound ?? 0} anomalie(s) détectée(s)`);
      fetchAnomalies(1);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Anomalies détectées</CardTitle>
          <Button size="sm" onClick={handleDetect} disabled={detecting}>
            {detecting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Lancer la détection
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-96">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Sévérité</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Détectée le</TableHead>
                <TableHead className="w-20">Résolue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : anomalies.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Aucune anomalie</TableCell></TableRow>
              ) : (
                anomalies.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><Badge variant="outline">{a.type}</Badge></TableCell>
                    <TableCell>
                      <Badge className={getSeverityStyles(a.severity)} variant="secondary">
                        {a.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{a.description}</TableCell>
                    <TableCell className="text-sm">{a.source ?? '—'}</TableCell>
                    <TableCell className="text-xs">{formatDate(a.detectedAt)}</TableCell>
                    <TableCell>{a.resolved ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        {total > 20 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">{total} anomalie(s)</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => fetchAnomalies(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => fetchAnomalies(page + 1)}>
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin: Purge Tab ────────────────────────────────────────

function AdminPurgeTab() {
  const [level, setLevel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [olderThanDays, setOlderThanDays] = useState('');
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<{ deletedCount: number } | null>(null);

  const handlePurge = async () => {
    setPurging(true);
    setResult(null);
    try {
      const payload: PurgePayload = {
        level: level || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        olderThanDays: olderThanDays ? Number(olderThanDays) : undefined,
      };
      const res = await api.admin.purgeLogs(payload);
      setResult({ deletedCount: res.deletedCount ?? 0 });
      toast.success(`${res.deletedCount ?? 0} logs supprimés`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la purge');
    } finally {
      setPurging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Purge des logs</CardTitle>
        <CardDescription>Supprimer des logs selon des critères. Cette action est irréversible.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Niveau</Label>
            <Select value={level} onValueChange={(v) => setLevel(v === 'ALL' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Tous les niveaux" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous</SelectItem>
                {Object.keys(LEVEL_COLORS).map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Plus ancien que (jours)</Label>
            <Input type="number" placeholder="ex: 90" value={olderThanDays} onChange={(e) => setOlderThanDays(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Date de début</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Date de fin</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={purging}>
              {purging ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Purger les logs
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmer la purge ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action supprimera définitivement les logs correspondant aux critères sélectionnés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={handlePurge}>Confirmer la purge</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {result !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="border-green-300 dark:border-green-700">
              <CardContent className="p-4">
                <p className="text-sm text-green-700 dark:text-green-400">
                  <CheckCircle className="h-4 w-4 inline mr-1" />
                  {result.deletedCount} log(s) supprimé(s) avec succès
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin: System Health Tab ────────────────────────────────

function AdminSystemHealthTab() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.getSystemHealth();
      setHealth(data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur santé système');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]); // No polling, refresh on mount

  const StatusItem = ({ label, value, status, icon: Icon, extra }: {
    label: string;
    value: string | number;
    status: 'ok' | 'warn' | 'error';
    icon: React.ElementType;
    extra?: string;
  }) => {
    let badgeVariant: 'default' | 'outline' | 'destructive' = 'default';
    let badgeClass = '';
    let badgeEmoji = '';

    switch (status) {
      case 'ok':
        badgeVariant = 'default';
        badgeClass = 'bg-green-500 hover:bg-green-600 text-white border-0';
        badgeEmoji = '🟢 ';
        break;
      case 'warn':
        badgeVariant = 'outline';
        badgeClass = 'text-orange-600 border-orange-200 bg-orange-50';
        badgeEmoji = '🟠 ';
        break;
      case 'error':
        badgeVariant = 'destructive';
        badgeClass = ''; // default destructive styling is fine
        badgeEmoji = '🔴 ';
        break;
    }

    return (
      <div className="flex items-center justify-between p-3 border rounded-lg bg-card">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${status === 'ok' ? 'bg-green-500/10 text-green-500' : status === 'warn' ? 'bg-orange-500/10 text-orange-500' : 'bg-red-500/10 text-red-500'}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium">{label}</p>
            {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={badgeVariant} className={badgeClass}>
            {badgeEmoji} {value}
          </Badge>
        </div>
      </div>
    );
  };

  if (loading && !health) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Connectivité & Services
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusItem 
              label="Base de données" 
              value={health?.databaseConnected ? "Connectée" : "Déconnectée"} 
              status={health?.databaseConnected ? "ok" : "error"}
              icon={Server}
              extra={`Taille: ${health?.dbSizeMb} Mo`}
            />
            <StatusItem 
              label="Service Cache (Redis)" 
              value={health?.redisConnected ? "Actif" : "Désactivé"} 
              status={health?.redisConnected ? "ok" : "warn"}
              icon={Zap}
              extra={health?.redisConnected ? "Mode hautes performances" : "Mode dégradé"}
            />
            <StatusItem 
              label="Watchers de fichiers" 
              value={health?.watcherRunning ? "Actif" : "Arrêté"} 
              status={health?.watcherRunning ? "ok" : "error"}
              icon={Eye}
              extra={health?.watcherRunning 
                ? `${health?.activeWatchers || 0} répertoires surveillés (${health?.watchedFiles || 0} fichiers)`
                : `${health?.activeWatchers || 0} répertoires configurés`}
            />
            <StatusItem
              label="Erreurs Watcher (24h)"
              value={health?.watcherErrors24h ?? 'N/A'}
              status={health?.watcherErrors24h === 0 ? "ok" : health?.watcherErrors24h && health.watcherErrors24h > 0 ? "error" : "warn"}
              icon={Bug}
              extra="Vérifiez les logs du Watcher"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Intégrité des Données
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusItem 
              label="Logs orphelins" 
              value={`${health?.orphanLogs} logs`} 
              status={health?.orphanLogs === 0 ? "ok" : health?.orphanLogs > 100 ? "error" : "warn"}
              icon={FolderOpen}
              extra={health?.lastOrphanImport 
                ? `Dernier: ${formatDate(health.lastOrphanImport)} (${health.orphanLogsAgeMinutes !== null ? `${health.orphanLogsAgeMinutes} min` : 'N/A'})` 
                : "Aucun import détecté"}
            />
            <StatusItem 
              label="Répertoires non mappés" 
              value={`${health?.unmappedWatchDirectories} répertoire(s)`} 
              status={health?.unmappedWatchDirectories === 0 ? "ok" : "error"}
              icon={AlertTriangle}
              extra="Vérifiez WATCH_DIR_USER_MAP"
            />
            <StatusItem
              label="Groupes d'erreurs ouverts"
              value={`${health?.openErrorGroups} groupes`}
              status={health?.openErrorGroups === 0 ? "ok" : "warn"}
              icon={Bug}
              extra="Groupes d'erreurs non résolus"
            />
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

function MainApp() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [unreadCount, setUnreadCount] = useState(0);
  const { user, logout, isAdmin } = useAuthStore();
  const { theme, setTheme } = useTheme();

  // Fetch unread alerts count
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const data = await api.alerts.getAlerts({ status: 'active', limit: 1 });
        setUnreadCount(data.pagination?.total ?? 0);
      } catch { /* silent */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
    toast.success('Déconnexion réussie');
  };

  const filteredNav = NAV_ITEMS.filter((n) => !n.adminOnly || isAdmin());

  const tabLabels: Record<TabKey, string> = {
    dashboard: 'Tableau de bord',
    weblog: 'WebLog',
    import: 'Import',
    alerts: 'Alertes',
    admin: 'Administration',
  };

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Activity className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg">LogSystem</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              {filteredNav.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={activeTab === item.key}
                    onClick={() => setActiveTab(item.key)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    {item.key === 'alerts' && unreadCount > 0 && (
                      <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-5 text-center">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="p-4">
            <Separator className="mb-3" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{user?.displayName ?? 'Utilisateur'}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email ?? ''}</p>
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <div className="min-h-screen flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-background/95 backdrop-blur [-webkit-backdrop-filter:blur(8px)] supports-[backdrop-filter]:bg-background/60 border-b">
              <div className="flex items-center gap-3 px-4 py-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="h-5" />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink>LogSystem</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbLink>{tabLabels[activeTab]}</BreadcrumbLink>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <div className="ml-auto flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 relative"
                        onClick={() => setActiveTab('alerts')}
                      >
                        <Bell className="h-4 w-4" />
                        {unreadCount > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Alertes</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      >
                        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          {(user?.displayName ?? 'U').charAt(0).toUpperCase()}
                        </div>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <div className="px-2 py-1.5">
                        <p className="text-sm font-medium">{user?.displayName}</p>
                        <p className="text-xs text-muted-foreground">{user?.email}</p>
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setActiveTab('alerts')}>
                        <Bell className="h-4 w-4 mr-2" /> Alertes
                      </DropdownMenuItem>
                      {isAdmin() && (
                        <DropdownMenuItem onClick={() => setActiveTab('admin')}>
                          <Shield className="h-4 w-4 mr-2" /> Administration
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                        <LogOut className="h-4 w-4 mr-2" /> Déconnexion
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </header>

            {/* Main content */}
            <main className="flex-1 p-4 lg:p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeTab === 'dashboard' && <DashboardView />}
                  {activeTab === 'weblog' && <WebLogView />}
                  {activeTab === 'import' && <ImportView />}
                  {activeTab === 'alerts' && <AlertsView />}
                  {activeTab === 'admin' && isAdmin() && <AdminView />}
                </motion.div>
              </AnimatePresence>
            </main>

            {/* Footer — sticky at bottom */}
            <footer className="mt-auto border-t px-4 py-3 text-center text-xs text-muted-foreground">
              LogSystem © {new Date().getFullYear()} — Plateforme de Gestion des Logs
            </footer>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROOT PAGE
// ═══════════════════════════════════════════════════════════════

export default function Home() {
  const { user, loading, initialized, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <MainApp />;
}
