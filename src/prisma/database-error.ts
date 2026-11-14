// Never log Prisma's full message: it can contain connection details or query data.
export function databaseErrorSummary(error: unknown): string {
  const value = error as { code?: string; errorCode?: string } | null;
  const rawCode = value?.code || value?.errorCode;
  const code = typeof rawCode === 'string' && /^P\d{4}$/.test(rawCode) ? rawCode : 'UNKNOWN';
  const hints: Record<string, string> = {
    P1000: 'Database authentication failed. Check the database credentials.',
    P1001: 'Database host is unreachable. Use a hosted DATABASE_URL, not localhost.',
    P1002: 'Database connection timed out.',
    P1003: 'Configured database does not exist.',
    P1010: 'Database user does not have access.',
    P1011: 'Database TLS connection failed.',
    P1012: 'Database configuration is invalid. Check DATABASE_URL.',
    P2021: 'Required table is missing. Restore or migrate the application schema.',
    P2022: 'Required column is missing. Apply the application schema changes.',
    P2024: 'Database connection pool timed out.',
  };
  return `[${code}] ${hints[code] || 'Database request failed. Inspect database configuration and availability.'}`;
}
