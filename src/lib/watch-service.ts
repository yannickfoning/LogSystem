/**
 * Watch Service — V4 feature ported to Next.js
 * Surveille des répertoires pour les nouveaux fichiers de logs et les importe automatiquement.
 * Activé uniquement si WATCH_DIRS est défini dans .env
 */
import { db } from './db';
import crypto from 'crypto';

let watcherInitialized = false;

export async function startWatchService() {
  const watchDirs = process.env.WATCH_DIRS;
  if (!watchDirs || watchDirs.trim() === '') {
    console.log('[WATCH] WATCH_DIRS non configuré — surveillance désactivée');
    return;
  }
  if (watcherInitialized) return;
  watcherInitialized = true;

  try {
    const chokidar = await import('chokidar');
    const fs = await import('fs');
    const path = await import('path');
    const { parseLogs } = await import('./processing/universal-parser');

    const dirs = watchDirs.split(',').map((d: string) => d.trim()).filter(Boolean);

    // Find default admin user
    const adminUser = await db.user.findFirst({ where: { role: 'admin', isActive: true } });
    const userId = adminUser?.id || null;

    console.log(`[WATCH] Surveillance démarrée sur: ${dirs.join(', ')}`);

    const watcher = chokidar.default.watch(dirs, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
    });

    const fileOffsets = new Map<string, number>();

    watcher.on('change', async (filePath: string) => {
      try {
        const stats = fs.default.statSync(filePath);
        const offset = fileOffsets.get(filePath) || 0;
        if (stats.size <= offset) return;

        const fd = fs.default.openSync(filePath, 'r');
        const newBytes = stats.size - offset;
        const buf = Buffer.alloc(newBytes);
        fs.default.readSync(fd, buf, 0, newBytes, offset);
        fs.default.closeSync(fd);
        fileOffsets.set(filePath, stats.size);

        const content = buf.toString('utf-8');
        const entries = parseLogs(content, path.default.basename(filePath));
        if (!entries.length) return;

        const now = new Date();
        const fileHash = crypto.createHash('sha256').update(buf).digest('hex');

        await db.log.createMany({
          data: entries.map(entry => ({
            ...entry,
            timestamp: entry.timestamp,
            userId: userId || undefined,
            fileName: path.default.basename(filePath),
            fileSize: BigInt(stats.size),
            fileHash,
            importDate: now.toISOString().slice(0, 10),
            importTimeOnly: now.toTimeString().slice(0, 8),
            importedByUserId: userId || undefined,
            importedByName: 'WatchService',
            sourceDirectory: path.default.dirname(filePath),
            sourceApplication: path.default.basename(filePath),
            integrityHash: crypto.createHash('sha256').update(entry.rawLog || entry.message || '').digest('hex'),
          })),
        });

        console.log(`[WATCH] ${entries.length} logs importés depuis ${filePath}`);

        // Persist offset
        await db.watchOffset.upsert({
          where: { path: filePath },
          update: { fileOffset: BigInt(stats.size) },
          create: { path: filePath, fileOffset: BigInt(stats.size) },
        });
      } catch (err) {
        console.error(`[WATCH] Erreur traitement ${filePath}:`, err);
      }
    });

    watcher.on('add', async (filePath: string) => {
      console.log(`[WATCH] Nouveau fichier détecté: ${filePath}`);
    });

    watcher.on('error', (err: Error) => {
      console.error('[WATCH] Erreur watcher:', err);
    });

    process.on('SIGTERM', () => { watcher.close(); console.log('[WATCH] Watcher arrêté'); });
    process.on('SIGINT',  () => { watcher.close(); });
  } catch (err) {
    console.error('[WATCH] Impossible de démarrer le watcher:', err);
  }
}
