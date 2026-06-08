import { getAuthUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`));

        const interval = setInterval(async () => {
          try {
            const whereBase = user.role === 'admin'
              ? {}
              : { OR: [{ userId: user.id }, { userId: null }] };

            const recentAlerts = await db.alert.findMany({
              where: {
                ...whereBase,
                createdAt: { gte: new Date(Date.now() - 10 * 1000) },
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
            });

            if (recentAlerts.length > 0) {
              for (const alert of recentAlerts) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'alert', data: alert })}\n\n`)
                );
              }
            }
          } catch {
            // Ignore DB errors in SSE
          }
        }, 5000);

        const cleanup = () => {
          clearInterval(interval);
          controller.close();
        };

        setTimeout(cleanup, 5 * 60 * 1000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch {
    return new Response('SSE Error', { status: 500 });
  }
}
