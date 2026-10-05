import postgres from "postgres";
import type { CompiledQuery } from "./compiler.js";

export type QueryExecutor = (
  query: CompiledQuery,
) => Promise<Array<Record<string, unknown>>>;

export function createQueryExecutor(databaseUrl: string): {
  execute: QueryExecutor;
  close: () => Promise<void>;
} {
  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 5,
    prepare: true,
  });

  return {
    execute: async (query) =>
      sql.begin("read only", async (transaction) => {
        await transaction.unsafe("SET LOCAL statement_timeout = '5s'");
        const rows = await transaction.unsafe(query.text, query.values);
        return rows.map((row) => ({ ...row }));
      }),
    close: async () => sql.end({ timeout: 3 }),
  };
}
