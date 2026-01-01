/**
 * Base Repository
 * 모든 Repository의 공통 DB 연결 및 유틸리티 제공
 */
import { Injectable } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

@Injectable()
export class BaseRepository {
  protected readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('Missing DATABASE_URL');
    }
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async waitForDb(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await this.pool.query('select 1');
        return;
      } catch (error) {
        lastError = error;
        await sleep(1000 + attempt * 500);
      }
    }
    throw lastError;
  }

  async endPool(): Promise<void> {
    await this.pool.end();
  }

  protected async query<T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }
}
