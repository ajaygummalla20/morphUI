import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { GatewayQueryPlan } from "../lib/gateway/contract";
import { compileQuery } from "../gateway/src/compiler";
import { applyMasking, gatewayPolicySchema } from "../gateway/src/policy";

const migrationsDirectory = fileURLToPath(
  new URL("../db/migrations", import.meta.url),
);

test("the Gateway compiler executes against PostgreSQL and masks before return", async (context) => {
  const database = new PGlite();
  context.after(async () => database.close());

  for (const migrationFile of (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(
      `${migrationsDirectory}/${migrationFile}`,
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }

  await database.exec(`
    insert into branches (id, code, name, city, state, region)
    values ('00000000-0000-4000-8000-000000000001', 'HYD01', 'Hyderabad Central', 'Hyderabad', 'Telangana', 'south');
    insert into customers (
      id, customer_number, type, segment, full_name, email, phone, city, state, postal_code
    ) values (
      '00000000-0000-4000-8000-000000000002', 'CUS00000001', 'corporate', 'sme',
      'Aarav Logistics', 'aarav@example.test', '+919000000001', 'Hyderabad', 'Telangana', '500001'
    );
    insert into relationship_managers (
      id, employee_code, branch_id, full_name, email, phone, joined_at
    ) values (
      '00000000-0000-4000-8000-000000000003', 'RM0001',
      '00000000-0000-4000-8000-000000000001', 'Neha Rao',
      'neha.rao@example.test', '+919000000002', current_date - interval '500 days'
    );
    insert into products (id, code, name, category, description)
    values (
      '00000000-0000-4000-8000-000000000004', 'MTR-PC-COMP',
      'Private Car Comprehensive', 'private_car', 'Synthetic test product'
    );
    insert into policies (
      id, policy_number, customer_id, product_id, branch_id, relationship_manager_id,
      business_type, status, channel, start_date, expiry_date, sum_insured,
      own_damage_premium, third_party_premium, gst_amount, total_premium,
      payment_status, issued_at
    ) values (
      '00000000-0000-4000-8000-000000000005', 'MTR-TEST-0001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
      'renewal', 'active', 'agent', current_date - interval '358 days',
      current_date + interval '7 days', 650000, 21000, 4500, 4590, 30090,
      'paid', current_timestamp - interval '358 days'
    );
  `);

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const toDate = new Date(today);
  toDate.setUTCDate(toDate.getUTCDate() + 15);
  const plan: GatewayQueryPlan = {
    source: "policies_read_replica",
    catalogVersion: "insurance-catalog-2026-09-01",
    operation: "select",
    entity: "policies",
    fields: [
      "policy_number",
      "customer_name",
      "expiry_date",
      "total_premium",
      "relationship_manager",
      "branch",
      "renewal_status",
      "propensity_score",
    ],
    filters: [
      {
        field: "expiry_date",
        operator: "between",
        value: `${from}..${toDate.toISOString().slice(0, 10)}`,
      },
      { field: "total_premium", operator: "greater_than", value: 20_000 },
    ],
    orderBy: [{ field: "expiry_date", direction: "asc" }],
    rowLimit: 20,
  };
  const compiled = compileQuery(plan);
  const result = await database.query<Record<string, unknown>>(
    compiled.text,
    compiled.values,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].policy_number, "MTR-TEST-0001");

  const policy = gatewayPolicySchema.parse(
    JSON.parse(
      await readFile(
        fileURLToPath(
          new URL("../gateway/config/policy.example.json", import.meta.url),
        ),
        "utf8",
      ),
    ),
  );
  const masked = applyMasking(result.rows, plan, policy);
  assert.equal(masked.rows[0].customer_name, "A•••••• customer");
  assert.deepEqual(masked.maskedFields, ["customer_name"]);
});
