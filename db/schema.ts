import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const customerTypeEnum = pgEnum("customer_type", [
  "individual",
  "corporate",
]);
export const customerSegmentEnum = pgEnum("customer_segment", [
  "retail",
  "sme",
  "corporate",
]);
export const regionEnum = pgEnum("region", [
  "north",
  "south",
  "east",
  "west",
  "central",
]);
export const policyStatusEnum = pgEnum("policy_status", [
  "draft",
  "pending_payment",
  "active",
  "expired",
  "cancelled",
]);
export const businessTypeEnum = pgEnum("business_type", ["new", "renewal"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);
export const salesChannelEnum = pgEnum("sales_channel", [
  "direct",
  "agent",
  "broker",
  "digital",
  "partner",
]);
export const vehicleTypeEnum = pgEnum("vehicle_type", [
  "private_car",
  "two_wheeler",
  "commercial_vehicle",
]);
export const fuelTypeEnum = pgEnum("fuel_type", [
  "petrol",
  "diesel",
  "cng",
  "electric",
  "hybrid",
]);
export const claimTypeEnum = pgEnum("claim_type", [
  "own_damage",
  "theft",
  "third_party",
]);
export const claimStatusEnum = pgEnum("claim_status", [
  "intimated",
  "documents_pending",
  "under_assessment",
  "approved",
  "settled",
  "rejected",
  "closed",
]);
export const renewalStatusEnum = pgEnum("renewal_status", [
  "due",
  "contacted",
  "quoted",
  "payment_pending",
  "converted",
  "lost",
  "lapsed",
]);
export const endorsementTypeEnum = pgEnum("endorsement_type", [
  "address_change",
  "name_correction",
  "vehicle_transfer",
  "hypothecation_add",
  "hypothecation_remove",
  "coverage_change",
  "cancellation",
]);
export const endorsementStatusEnum = pgEnum("endorsement_status", [
  "requested",
  "documents_pending",
  "under_review",
  "approved",
  "rejected",
  "completed",
]);

const money = (name: string) =>
  numeric(name, { precision: 14, scale: 2, mode: "number" });

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 12 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    state: varchar("state", { length: 80 }).notNull(),
    region: regionEnum("region").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("branches_code_uidx").on(table.code),
    index("branches_region_idx").on(table.region),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerNumber: varchar("customer_number", { length: 20 }).notNull(),
    type: customerTypeEnum("type").notNull(),
    segment: customerSegmentEnum("segment").notNull(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    email: varchar("email", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    state: varchar("state", { length: 80 }).notNull(),
    postalCode: varchar("postal_code", { length: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customers_number_uidx").on(table.customerNumber),
    uniqueIndex("customers_email_uidx").on(table.email),
    index("customers_segment_idx").on(table.segment),
    index("customers_location_idx").on(table.state, table.city),
  ],
);

export const relationshipManagers = pgTable(
  "relationship_managers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeCode: varchar("employee_code", { length: 20 }).notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    email: varchar("email", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    active: boolean("active").notNull().default(true),
    joinedAt: date("joined_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("relationship_managers_employee_uidx").on(table.employeeCode),
    uniqueIndex("relationship_managers_email_uidx").on(table.email),
    index("relationship_managers_branch_idx").on(table.branchId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 140 }).notNull(),
    category: vehicleTypeEnum("category").notNull(),
    description: text("description").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("products_code_uidx").on(table.code)],
);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyNumber: varchar("policy_number", { length: 32 }).notNull(),
    previousPolicyId: uuid("previous_policy_id").references(
      (): AnyPgColumn => policies.id,
      { onDelete: "set null" },
    ),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    relationshipManagerId: uuid("relationship_manager_id")
      .notNull()
      .references(() => relationshipManagers.id, { onDelete: "restrict" }),
    businessType: businessTypeEnum("business_type").notNull(),
    status: policyStatusEnum("status").notNull(),
    channel: salesChannelEnum("channel").notNull(),
    startDate: date("start_date", { mode: "date" }).notNull(),
    expiryDate: date("expiry_date", { mode: "date" }).notNull(),
    sumInsured: money("sum_insured").notNull(),
    ownDamagePremium: money("own_damage_premium").notNull(),
    thirdPartyPremium: money("third_party_premium").notNull(),
    gstAmount: money("gst_amount").notNull(),
    totalPremium: money("total_premium").notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("policies_number_uidx").on(table.policyNumber),
    index("policies_customer_idx").on(table.customerId),
    index("policies_expiry_status_idx").on(table.expiryDate, table.status),
    index("policies_branch_expiry_idx").on(table.branchId, table.expiryDate),
    index("policies_rm_expiry_idx").on(
      table.relationshipManagerId,
      table.expiryDate,
    ),
    check("policies_valid_dates_chk", sql`${table.expiryDate} > ${table.startDate}`),
    check(
      "policies_non_negative_values_chk",
      sql`${table.sumInsured} >= 0 and ${table.totalPremium} >= 0`,
    ),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    registrationNumber: varchar("registration_number", { length: 20 }).notNull(),
    vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
    make: varchar("make", { length: 80 }).notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    variant: varchar("variant", { length: 100 }).notNull(),
    fuelType: fuelTypeEnum("fuel_type").notNull(),
    manufactureYear: integer("manufacture_year").notNull(),
    engineNumber: varchar("engine_number", { length: 40 }).notNull(),
    chassisNumber: varchar("chassis_number", { length: 40 }).notNull(),
    insuredDeclaredValue: money("insured_declared_value").notNull(),
  },
  (table) => [
    uniqueIndex("vehicles_policy_uidx").on(table.policyId),
    index("vehicles_registration_idx").on(table.registrationNumber),
    check(
      "vehicles_year_chk",
      sql`${table.manufactureYear} between 1995 and 2100`,
    ),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimNumber: varchar("claim_number", { length: 32 }).notNull(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    type: claimTypeEnum("type").notNull(),
    status: claimStatusEnum("status").notNull(),
    incidentDate: date("incident_date", { mode: "date" }).notNull(),
    intimationDate: date("intimation_date", { mode: "date" }).notNull(),
    claimedAmount: money("claimed_amount").notNull(),
    approvedAmount: money("approved_amount"),
    settledAmount: money("settled_amount"),
    cause: varchar("cause", { length: 180 }).notNull(),
    surveyorName: varchar("surveyor_name", { length: 120 }),
    garageName: varchar("garage_name", { length: 160 }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("claims_number_uidx").on(table.claimNumber),
    index("claims_policy_idx").on(table.policyId),
    index("claims_status_intimation_idx").on(table.status, table.intimationDate),
    index("claims_branch_intimation_idx").on(table.branchId, table.intimationDate),
    check(
      "claims_valid_dates_chk",
      sql`${table.intimationDate} >= ${table.incidentDate}`,
    ),
    check("claims_non_negative_amount_chk", sql`${table.claimedAmount} >= 0`),
  ],
);

export const renewals = pgTable(
  "renewals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    renewedPolicyId: uuid("renewed_policy_id").references(
      (): AnyPgColumn => policies.id,
      { onDelete: "set null" },
    ),
    assignedToId: uuid("assigned_to_id")
      .notNull()
      .references(() => relationshipManagers.id, { onDelete: "restrict" }),
    dueDate: date("due_date", { mode: "date" }).notNull(),
    status: renewalStatusEnum("status").notNull(),
    currentPremium: money("current_premium").notNull(),
    quotedPremium: money("quoted_premium"),
    propensityScore: numeric("propensity_score", {
      precision: 5,
      scale: 2,
      mode: "number",
    }).notNull(),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lostReason: varchar("lost_reason", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("renewals_policy_uidx").on(table.policyId),
    index("renewals_due_status_idx").on(table.dueDate, table.status),
    index("renewals_assignee_due_idx").on(table.assignedToId, table.dueDate),
    check(
      "renewals_propensity_score_chk",
      sql`${table.propensityScore} between 0 and 100`,
    ),
  ],
);

export const endorsements = pgTable(
  "endorsements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endorsementNumber: varchar("endorsement_number", { length: 32 }).notNull(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "restrict" }),
    type: endorsementTypeEnum("type").notNull(),
    status: endorsementStatusEnum("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    effectiveDate: date("effective_date", { mode: "date" }).notNull(),
    premiumDelta: money("premium_delta").notNull().default(0),
    notes: text("notes").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("endorsements_number_uidx").on(table.endorsementNumber),
    index("endorsements_policy_idx").on(table.policyId),
    index("endorsements_status_requested_idx").on(
      table.status,
      table.requestedAt,
    ),
  ],
);

export const branchesRelations = relations(branches, ({ many }) => ({
  relationshipManagers: many(relationshipManagers),
  policies: many(policies),
  claims: many(claims),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  policies: many(policies),
}));

export const relationshipManagersRelations = relations(
  relationshipManagers,
  ({ one, many }) => ({
    branch: one(branches, {
      fields: [relationshipManagers.branchId],
      references: [branches.id],
    }),
    policies: many(policies),
    renewals: many(renewals),
  }),
);

export const productsRelations = relations(products, ({ many }) => ({
  policies: many(policies),
}));

export const policiesRelations = relations(policies, ({ one, many }) => ({
  customer: one(customers, {
    fields: [policies.customerId],
    references: [customers.id],
  }),
  product: one(products, {
    fields: [policies.productId],
    references: [products.id],
  }),
  branch: one(branches, {
    fields: [policies.branchId],
    references: [branches.id],
  }),
  relationshipManager: one(relationshipManagers, {
    fields: [policies.relationshipManagerId],
    references: [relationshipManagers.id],
  }),
  vehicle: one(vehicles),
  claims: many(claims),
  renewals: many(renewals),
  endorsements: many(endorsements),
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  policy: one(policies, {
    fields: [vehicles.policyId],
    references: [policies.id],
  }),
}));

export const claimsRelations = relations(claims, ({ one }) => ({
  policy: one(policies, {
    fields: [claims.policyId],
    references: [policies.id],
  }),
  branch: one(branches, {
    fields: [claims.branchId],
    references: [branches.id],
  }),
}));

export const renewalsRelations = relations(renewals, ({ one }) => ({
  policy: one(policies, {
    fields: [renewals.policyId],
    references: [policies.id],
    relationName: "renewalOriginalPolicy",
  }),
  renewedPolicy: one(policies, {
    fields: [renewals.renewedPolicyId],
    references: [policies.id],
    relationName: "renewalNewPolicy",
  }),
  assignedTo: one(relationshipManagers, {
    fields: [renewals.assignedToId],
    references: [relationshipManagers.id],
  }),
}));

export const endorsementsRelations = relations(endorsements, ({ one }) => ({
  policy: one(policies, {
    fields: [endorsements.policyId],
    references: [policies.id],
  }),
}));

export type Branch = typeof branches.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type RelationshipManager = typeof relationshipManagers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type Renewal = typeof renewals.$inferSelect;
export type Endorsement = typeof endorsements.$inferSelect;
