import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const defaultLocalUrl =
  "postgresql://morphui:morphui_dev@localhost:5434/morphui";

export function createDatabase(databaseUrl = process.env.DATABASE_URL) {
  const url = databaseUrl ?? defaultLocalUrl;
  const client = postgres(url, {
    max: process.env.NODE_ENV === "production" ? 10 : 4,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return {
    db: drizzle(client, { schema }),
    client,
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
