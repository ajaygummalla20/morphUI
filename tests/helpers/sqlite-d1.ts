import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Executes Drizzle's real SQL against SQLite, including FK/unique constraints.
// Only the D1 transport is replaced; queries and application functions are real.
export function createSqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  function prepare(sql: string, parameters: SQLInputValue[] = []) {
    return {
      bind(...values: SQLInputValue[]) {
        return prepare(sql, values);
      },
      async raw() {
        const statement = sqlite.prepare(sql);
        statement.setReturnArrays(true);
        return statement.all(...parameters);
      },
      async all() {
        const results = sqlite.prepare(sql).all(...parameters);
        const changes = sqlite.prepare("SELECT changes() AS changes").get()?.changes;
        return { success: true, results, meta: { changes: Number(changes ?? 0) } };
      },
      async first(column?: string) {
        const result = sqlite.prepare(sql).get(...parameters);
        return column ? result?.[column] ?? null : result ?? null;
      },
      async run() {
        const result = sqlite.prepare(sql).run(...parameters);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
    };
  }

  const d1 = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return { sqlite, d1, close: () => sqlite.close() };
}
