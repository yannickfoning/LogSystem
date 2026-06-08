import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
