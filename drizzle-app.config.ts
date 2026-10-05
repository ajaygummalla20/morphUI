import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/app-state-schema.ts",
  dialect: "sqlite",
  strict: true,
  verbose: true,
});
