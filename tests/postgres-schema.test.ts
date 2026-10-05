import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = fileURLToPath(
  new URL("../db/migrations", import.meta.url),
);

test("PostgreSQL migration creates a queryable insurance model", async (context) => {
  const database = new PGlite();
  context.after(async () => database.close());

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  assert.ok(migrationFiles.length > 0, "at least one migration is required");

  for (const migrationFile of migrationFiles) {
    const migrationSql = await readFile(
      `${migrationsDirectory}/${migrationFile}`,
      "utf8",
    );
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await database.exec(statement);
    }
  }

  const tables = await database.query<{ table_count: number }>(`
    select count(*)::int as table_count
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'branches', 'customers', 'relationship_managers', 'products',
        'policies', 'vehicles', 'claims', 'renewals', 'endorsements'
      )
  `);
  assert.equal(tables.rows[0].table_count, 9);

  await database.exec(`
    insert into branches (id, code, name, city, state, region)
    values ('00000000-0000-4000-8000-000000000001', 'HYD01', 'Hyderabad Central', 'Hyderabad', 'Telangana', 'south');

    insert into customers (
      id, customer_number, type, segment, full_name, email, phone, city, state, postal_code
    ) values (
      '00000000-0000-4000-8000-000000000002', 'CUS00000001', 'corporate', 'sme',
      'Aarav Logistics Demo', 'aarav@example.test', '+919000000001', 'Hyderabad', 'Telangana', '500001'
    );

    insert into relationship_managers (
      id, employee_code, branch_id, full_name, email, phone, joined_at
    ) values (
      '00000000-0000-4000-8000-000000000003', 'RM0001',
      '00000000-0000-4000-8000-000000000001', 'Neha Rao',
      'neha.rao@morphui.example', '+919000000002', current_date - interval '500 days'
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

  const expiring = await database.query<{ policy_number: string }>(`
    select policy_number
    from policies
    where expiry_date between current_date and current_date + interval '15 days'
      and total_premium > 20000
  `);
  assert.deepEqual(expiring.rows, [{ policy_number: "MTR-TEST-0001" }]);

  await assert.rejects(
    database.exec(`
      insert into claims (
        claim_number, policy_id, branch_id, type, status, incident_date,
        intimation_date, claimed_amount, cause
      ) values (
        'CLM-INVALID-1', '00000000-0000-4000-8000-000000000005',
        '00000000-0000-4000-8000-000000000001', 'own_damage', 'intimated',
        current_date, current_date - interval '1 day', 25000, 'Invalid test dates'
      )
    `),
    /claims_valid_dates_chk/,
  );
});
