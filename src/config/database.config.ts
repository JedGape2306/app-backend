import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host:     process.env.DATABASE_HOST     || 'localhost',
      port:     parseInt(process.env.DATABASE_PORT || '5432'),
      database: process.env.DATABASE_NAME     || 'pizzeria_db',
      user:     process.env.DATABASE_USER     || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'edgar2305',
      max: 10,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function query(text: string, params?: any[]): Promise<any[]> {
  const db = getPool();
  const result = await db.query(text, params);
  return result.rows;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}