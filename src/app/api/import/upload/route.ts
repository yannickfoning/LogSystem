import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { parseLogs } from '@/lib/processing/universal-parser';
import { isArchive, extractArchive } from '@/lib/processing/archive-handler';
import { normalizeLevel } from '@/lib/processing/levels';
import { generateFingerprint, generateErrorTitle } from '@/lib/processing/fingerprint';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/request-utils';
import path from 'path';
import fs from 'fs/promises';

const UPLOAD_DIR = '/tmp/logsystem-uploads';

async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch { /* exists */ }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const importSource = formData.get('source') as string | null;
    const importService = formData.get('service') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = file.name;
    const ext = path.extname(filename).toLowerCase();

    // Validate file type
    const allowedExts = ['.txt', '.log', '.json', '.jsonl', '.csv', '.xml', '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.tar.gz'];
    if (!allowedExts.some((allowed) => filename.toLowerCase().endsWith(allowed))) {
      return NextResponse.json({ error: `Unsupported file type: ${ext}` }, { status: 400 });
    }

    if (file.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 100 MB.' }, { status: 413 });
    }

    // Create import job
    const job = await db.importJob.create({
      data: {
        filename,
        status: 'processing',
        importSource: importSource || undefined,
        importService: importService || undefined,
        userId: user.id,
        startedAt: new Date(),
      },
    });

    // Process asynchronously
    processFile(file, job.id, user.id, user.email, user.displayName ?? null, getClientIp(request), importSource, importService).catch(console.error);

    return NextResponse.json({ jobId: job.id, status: 'processing' });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden: Admin access required')) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Import upload error:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}

async function processFile(
  file: File,
  jobId: string,
  userId: string,
  userEmail: string,
  userName: string | null,
  importIp: string,
  importSource: string | null,
  importService: string | null
) {
  try {
    await ensureUploadDir();
    const filePath = path.join(UPLOAD_DIR, `${jobId}_${file.name}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    const stat = await fs.stat(filePath);
    const importedAt = new Date();

    const filename = file.name;
    const importFiles = isArchive(filename)
      ? (await extractArchive(filePath, filename)).files
      : [{ name: filename, content: buffer.toString('utf-8'), size: buffer.length, modifiedAt: stat.mtime }];

    const parsedFiles = importFiles.map((importedFile) => ({
      ...importedFile,
      entries: parseLogs(importedFile.content, importedFile.name),
    }));
    const entries = parsedFiles.flatMap((fileInfo) => fileInfo.entries);

    let processedLines = 0;
    let errorCount = 0;
    let skippedLines = 0;

    // Batch insert logs
    const BATCH_SIZE = 100;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = parsedFiles.flatMap((fileInfo) => (
        fileInfo.entries.map((entry) => ({ entry, fileInfo }))
      )).slice(i, i + BATCH_SIZE);
      try {
        await db.log.createMany({
          data: batch.map(({ entry, fileInfo }) => ({
            rawLog: entry.rawLog,
            timestamp: entry.timestamp,
            createdAtLog: entry.timestamp,
            createdTimeLog: formatTime(entry.timestamp),
            importedAt,
            importedTime: formatTime(importedAt),
            logLevel: entry.logLevel,
            source: entry.source || importSource || undefined,
            sourceServer: entry.sourceServer || undefined,
            service: entry.service || importService || undefined,
            message: entry.message,
            normalizedMessage: entry.normalizedMessage || undefined,
            eventType: entry.eventType,
            fingerprint: entry.fingerprint || undefined,
            clientIp: entry.clientIp || undefined,
            module: entry.module || undefined,
            errorType: entry.errorType || undefined,
            stackTrace: entry.stackTrace || undefined,
            targetUser: entry.targetUser || undefined,
            parserFormat: entry.parserFormat || undefined,
            importDate: importedAt.toISOString().slice(0, 10),
            importTimeOnly: formatTime(importedAt),
            importedByUserId: userId,
            importedByEmail: userEmail,
            importedByName: userName || undefined,
            importIp,
            sourceDirectory: path.dirname(fileInfo.name) === '.' ? undefined : path.dirname(fileInfo.name),
            sourceApplication: importService || undefined,
            fileName: fileInfo.name,
            fileSize: BigInt(fileInfo.size || Buffer.byteLength(fileInfo.content)),
            fileCreatedAt: stat.birthtime,
            fileModifiedAt: fileInfo.modifiedAt || stat.mtime,
            userId,
            importJobId: jobId,
          })),
        });
        processedLines += batch.length;
      } catch (batchError) {
        console.error('Batch insert error:', batchError);
        errorCount += batch.length;
      }
    }

    // Update error groups for error-level logs
    const errorEntries = entries.filter(e => ['ERROR', 'CRITICAL', 'FATAL'].includes(e.logLevel) && e.fingerprint);
    for (const entry of errorEntries) {
      if (!entry.fingerprint) continue;
      try {
        const existing = await db.errorGroup.findUnique({
          where: { fingerprint: entry.fingerprint },
        });
        if (existing) {
          const wasResolved = existing.status === 'resolved';
          await db.errorGroup.update({
            where: { fingerprint: entry.fingerprint },
            data: {
              occurrenceCount: { increment: 1 },
              lastSeen: entry.timestamp,
              previousSeen: existing.lastSeen,
              severityMax: getHigherSeverity(existing.severityMax || '', entry.logLevel),
              ...(wasResolved ? {
                status: 'active',
                returnedAt: entry.timestamp,
                returnCount: { increment: 1 },
                returnReason: 'Error reappeared after resolution',
              } : {}),
            },
          });
        } else {
          await db.errorGroup.create({
            data: {
              fingerprint: entry.fingerprint,
              title: generateErrorTitle(entry.normalizedMessage || entry.message, entry.errorType),
              eventType: entry.eventType,
              severityMax: entry.logLevel,
              firstSeen: entry.timestamp,
              lastSeen: entry.timestamp,
              sourceServer: entry.sourceServer || undefined,
              service: entry.service || importService || undefined,
              errorType: entry.errorType || undefined,
              sampleLogId: undefined,
              userId,
            },
          });
        }
      } catch (err) {
        console.error('Error group update error:', err);
      }
    }

    // Generate summary
    const levelCounts: Record<string, number> = {};
    for (const entry of entries) {
      const level = normalizeLevel(entry.logLevel);
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    }

    // Update job
    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        totalLines: entries.length,
        processedLines,
        errorCount,
        skippedLines,
        completedAt: new Date(),
        importSummary: JSON.stringify({ levelCounts, totalParsed: entries.length }),
      },
    });

    await recordAudit({
      userId,
      userEmail,
      action: 'import',
      resourceType: 'import_job',
      resourceId: jobId,
      details: { filename, files: importFiles.map((f) => f.name), processedLines, errorCount },
      ipAddress: importIp,
      status: errorCount > 0 ? 'failure' : 'success',
    });

    // Cleanup temp file
    await fs.unlink(filePath).catch(() => {});
  } catch (error) {
    console.error('File processing error:', error);
    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      },
    });
  }
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

function getHigherSeverity(current: string, candidate: string): string {
  const order = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
  const ci = order.indexOf(current);
  const cani = order.indexOf(candidate);
  return cani > ci ? candidate : current || candidate;
}
