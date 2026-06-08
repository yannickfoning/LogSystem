/**
 * Initialisation des services serveur au premier démarrage.
 * Importé par instrumentation.ts (Next.js 15+) pour exécution au démarrage.
 */
let initialized = false;

export async function initServices() {
  if (initialized) return;
  initialized = true;

  try {
    // Seed alertes par défaut
    const { seedDefaultRules } = await import('@/lib/seed-default-rules');
    await seedDefaultRules();

    // Démarrer rétention automatique
    const { startRetentionScheduler } = await import('@/lib/retention-service');
    startRetentionScheduler();

    // Démarrer surveillance fichiers (si configuré)
    const { startWatchService } = await import('@/lib/watch-service');
    await startWatchService();

    console.log('[INIT] Services démarrés avec succès');
  } catch (e) {
    console.error('[INIT] Erreur initialisation services:', e);
  }
}
