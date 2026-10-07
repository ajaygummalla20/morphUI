import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { compileQuery } from "../gateway/src/compiler";

const migrationsDirectory = fileURLToPath(new URL("../db/migrations", import.meta.url));

function premiumGrowthPlan(rowLimit = 12) {
  return {
    source: "policies_read_replica",
    catalogVersion: "insurance-catalog-2026-09-01",
    operation: "select" as const,
    entity: "policies" as const,
    fields: ["start_date", "total_premium"],
    filters: [{ field: "status", operator: "equals" as const, value: "active" }],
    orderBy: [],
    rowLimit,
    analysis: {
      metricId: "written_premium",
      time: {
        field: "start_date",
        grain: "month" as const,
        start: "2026-01-01",
        end: "2026-03-31",
      },
      comparison: "previous_bucket" as const,
    },
  };
}

function numericBuckets(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    bucket: row.bucket,
    group: row.group,
    value: Number(row.value),
    record_count: Number(row.record_count),
  }));
}

test("PostgreSQL premium analytics aggregate the matching portfolio before applying result limits", async (context) => {
  const database = new PGlite();
  context.after(async () => database.close());
  for (const migrationFile of (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort()) {
    const migration = await readFile(`${migrationsDirectory}/${migrationFile}`, "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
  await database.exec(`
    INSERT INTO branches (id, code, name, city, state, region)
    VALUES ('00000000-0000-4000-8000-000000000001', 'TEST01', 'Synthetic branch', 'Hyderabad', 'Telangana', 'south');
    INSERT INTO customers (id, customer_number, type, segment, full_name, email, phone, city, state, postal_code)
    VALUES ('00000000-0000-4000-8000-000000000002', 'CUS-ANALYTICS', 'corporate', 'sme', 'Synthetic customer',
      'analytics@example.test', '+919000000001', 'Hyderabad', 'Telangana', '500001');
    INSERT INTO relationship_managers (id, employee_code, branch_id, full_name, email, phone, joined_at)
    VALUES ('00000000-0000-4000-8000-000000000003', 'RM-ANALYTICS', '00000000-0000-4000-8000-000000000001',
      'Synthetic manager', 'manager@example.test', '+919000000002', DATE '2025-01-01');
    INSERT INTO products (id, code, name, category, description)
    VALUES ('00000000-0000-4000-8000-000000000004', 'MTR-ANALYTICS', 'Motor analytics fixture', 'private_car', 'Synthetic test product');
    INSERT INTO policies (
      id, policy_number, customer_id, product_id, branch_id, relationship_manager_id,
      business_type, status, channel, start_date, expiry_date, sum_insured,
      own_damage_premium, third_party_premium, gst_amount, total_premium, payment_status, issued_at
    )
    SELECT md5('analytics-policy-' || g)::uuid, 'MTR-ANALYTICS-' || g,
      '00000000-0000-4000-8000-000000000002'::uuid,
      '00000000-0000-4000-8000-000000000004'::uuid,
      '00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000003'::uuid,
      'new'::business_type,
      (CASE WHEN g = 554 THEN 'cancelled' ELSE 'active' END)::policy_status,
      'agent'::sales_channel,
      (CASE WHEN g <= 250 THEN DATE '2026-01-15'
        WHEN g <= 550 THEN DATE '2026-02-15'
        WHEN g <= 553 THEN DATE '2026-03-31'
        WHEN g = 554 THEN DATE '2026-01-15'
        WHEN g = 555 THEN DATE '2025-12-31'
        ELSE DATE '2026-04-01' END),
      DATE '2027-05-01', 100000, 0, 0, 0,
      CASE WHEN g <= 250 THEN 100 WHEN g <= 550 THEN 200 WHEN g <= 553 THEN 300 ELSE 1000000 END,
      'paid'::payment_status, TIMESTAMP '2026-01-01'
    FROM generate_series(1, 556) AS g;
  `);

  await context.test("monthly totals include more than 200 policies and exclude out-of-period or filtered records", async () => {
    const compiled = compileQuery(premiumGrowthPlan());
    const result = await database.query<Record<string, unknown>>(compiled.text, compiled.values);
    assert.deepEqual(numericBuckets(result.rows), [
      { bucket: "2026-01-01", group: null, value: 25000, record_count: 250 },
      { bucket: "2026-02-01", group: null, value: 60000, record_count: 300 },
      { bucket: "2026-03-01", group: null, value: 900, record_count: 3 },
    ]);
  });

  await context.test("a one-bucket cap returns a second fully aggregated lookahead bucket to detect incomplete results", async () => {
    const compiled = compileQuery(premiumGrowthPlan(1));
    const result = await database.query<Record<string, unknown>>(compiled.text, compiled.values);
    assert.deepEqual(numericBuckets(result.rows), [
      { bucket: "2026-01-01", group: null, value: 25000, record_count: 250 },
      { bucket: "2026-02-01", group: null, value: 60000, record_count: 300 },
    ]);
  });

  await context.test("timestamp analysis includes the last day's noon and uses UTC month boundaries in a non-UTC session", async () => {
    await database.exec(`
      SET TIME ZONE 'Asia/Kolkata';
      INSERT INTO endorsements (id, endorsement_number, policy_id, type, status, requested_at, effective_date, premium_delta, notes)
      VALUES
        (md5('utc-endorsement-1')::uuid, 'END-UTC-1', md5('analytics-policy-1')::uuid, 'coverage_change', 'requested', TIMESTAMPTZ '2026-01-31 23:59:00+00', DATE '2026-02-01', 100, 'Synthetic'),
        (md5('utc-endorsement-2')::uuid, 'END-UTC-2', md5('analytics-policy-1')::uuid, 'coverage_change', 'requested', TIMESTAMPTZ '2026-02-01 00:00:00+00', DATE '2026-02-01', 200, 'Synthetic'),
        (md5('utc-endorsement-3')::uuid, 'END-UTC-3', md5('analytics-policy-1')::uuid, 'coverage_change', 'requested', TIMESTAMPTZ '2026-03-31 12:00:00+00', DATE '2026-04-01', 300, 'Synthetic'),
        (md5('utc-endorsement-4')::uuid, 'END-UTC-4', md5('analytics-policy-1')::uuid, 'coverage_change', 'requested', TIMESTAMPTZ '2026-04-01 00:00:00+00', DATE '2026-04-01', 1000000, 'Synthetic');
    `);
    const plan = {
      ...premiumGrowthPlan(),
      source: "endorsements_read_replica",
      entity: "endorsements" as const,
      fields: ["requested_at", "premium_delta"],
      filters: [],
      analysis: {
        metricId: "premium_impact",
        time: { field: "requested_at", grain: "month" as const, start: "2026-01-01", end: "2026-03-31" },
        comparison: "previous_bucket" as const,
      },
    };
    const compiled = compileQuery(plan);
    const result = await database.query<Record<string, unknown>>(compiled.text, compiled.values);
    assert.deepEqual(numericBuckets(result.rows), [
      { bucket: "2026-01-01", group: null, value: 100, record_count: 1 },
      { bucket: "2026-02-01", group: null, value: 200, record_count: 1 },
      { bucket: "2026-03-01", group: null, value: 300, record_count: 1 },
    ]);
  });
});

test("the compiler rejects an unknown analytic measure instead of returning policy records", () => {
  const plan = premiumGrowthPlan();
  plan.analysis.metricId = "unapproved_premium_measure";
  assert.throws(() => compileQuery(plan), /metric|measure|approved/i);
});
