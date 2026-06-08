export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initServices } = await import('./src/app/api/_startup/init');
    await initServices();
  }
}
