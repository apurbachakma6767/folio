/**
 * Apply Folio SQL migrations via Postgres connection.
 *
 * Requires DATABASE_URL or SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in env:
 *   postgresql://postgres.[ref]:[password]@aws-0-REGION.pooler.supabase.com:6543/postgres
 * or
 *   SUPABASE_DB_PASSWORD=...  (builds URL from NEXT_PUBLIC_SUPABASE_URL)
 *
 * Run: npx tsx scripts/run-migrations.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg') as typeof import('pg');

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const ref = projectUrl.replace('https://', '').split('.')[0];
  const password =
    process.env.SUPABASE_DB_PASSWORD ||
    process.env.DB_PASSWORD ||
    process.env.POSTGRES_PASSWORD;

  let connectionString =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL;

  if (!connectionString && password && ref) {
    // Transaction pooler (IPv4-friendly). Region may vary by project.
    const region =
      process.env.SUPABASE_DB_REGION ||
      process.env.SUPABASE_POOLER_HOST ||
      'aws-1-ap-northeast-1.pooler.supabase.com';
    const host = region.includes('pooler.supabase.com')
      ? region
      : `aws-0-${region}.pooler.supabase.com`;
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres`;
  }

  if (!connectionString) {
    console.error(`
Missing database credentials.

Add one of these to .env.local:
  DATABASE_URL=postgresql://postgres.${ref || 'PROJECT'}:YOUR_DB_PASSWORD@db.${ref || 'PROJECT'}.supabase.co:5432/postgres
  # or
  SUPABASE_DB_PASSWORD=your-database-password

Find the password in Supabase Dashboard → Project Settings → Database.
`);
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to database');

  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Track applied migrations
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.folio_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM public.folio_schema_migrations WHERE id = $1',
      [file]
    );
    if (rows.length) {
      console.log(`skip  ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`apply ${file}...`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO public.folio_schema_migrations (id) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.log(`  ok   ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code;
      // Idempotent: already exists / duplicate objects → mark applied and continue
      if (
        code === '42P07' ||
        code === '42710' ||
        /already exists/i.test(msg)
      ) {
        await client.query(
          'INSERT INTO public.folio_schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING',
          [file]
        );
        console.log(`  skip ${file} (already applied: ${msg.slice(0, 80)})`);
        continue;
      }
      console.error(`  FAIL ${file}:`, msg);
      throw e;
    }
  }

  await client.end();
  console.log('\nAll migrations applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
