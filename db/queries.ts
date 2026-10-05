import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  inArray,
  sql,
  sum,
} from "drizzle-orm";
import type { Database } from "./index";
import {
  branches,
  claims,
  customers,
  endorsements,
  policies,
  products,
  relationshipManagers,
  renewals,
} from "./schema";

export async function getInsuranceRecordCounts(db: Database) {
  const [policyCount, claimCount, renewalCount] = await Promise.all([
    db.select({ count: count() }).from(policies),
    db.select({ count: count() }).from(claims),
    db.select({ count: count() }).from(renewals),
  ]);

  return {
    policies: Number(policyCount[0].count),
    claims: Number(claimCount[0].count),
    renewals: Number(renewalCount[0].count),
  };
}

export async function getPolicyPortfolio(
  db: Database,
  options: { minimumPremium?: number; limit?: number } = {},
) {
  const limit = Math.min(options.limit ?? 200, 200);

  return db
    .select({
      policyNumber: policies.policyNumber,
      customerName: customers.fullName,
      product: products.name,
      branch: branches.name,
      relationshipManager: relationshipManagers.fullName,
      startDate: policies.startDate,
      expiryDate: policies.expiryDate,
      premium: policies.totalPremium,
      status: policies.status,
    })
    .from(policies)
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .innerJoin(products, eq(products.id, policies.productId))
    .innerJoin(branches, eq(branches.id, policies.branchId))
    .innerJoin(
      relationshipManagers,
      eq(relationshipManagers.id, policies.relationshipManagerId),
    )
    .where(
      and(
        eq(policies.status, "active"),
        gt(policies.totalPremium, options.minimumPremium ?? 0),
      ),
    )
    .orderBy(desc(policies.totalPremium), asc(policies.expiryDate))
    .limit(limit);
}

export async function getClaimsWorkspaceRows(
  db: Database,
  options: {
    asOf?: Date;
    minimumClaimAmount?: number;
    limit?: number;
  } = {},
) {
  const asOf = options.asOf ?? new Date();
  const from = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const to = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  const limit = Math.min(options.limit ?? 200, 200);

  return db
    .select({
      claimNumber: claims.claimNumber,
      policyNumber: policies.policyNumber,
      customerName: customers.fullName,
      branch: branches.name,
      intimationDate: claims.intimationDate,
      claimedAmount: claims.claimedAmount,
      approvedAmount: claims.approvedAmount,
      status: claims.status,
      cause: claims.cause,
    })
    .from(claims)
    .innerJoin(policies, eq(policies.id, claims.policyId))
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .innerJoin(branches, eq(branches.id, claims.branchId))
    .where(
      and(
        between(claims.intimationDate, from, to),
        gt(claims.claimedAmount, options.minimumClaimAmount ?? 0),
      ),
    )
    .orderBy(desc(claims.claimedAmount), desc(claims.intimationDate))
    .limit(limit);
}

export async function getPendingEndorsements(
  db: Database,
  options: { limit?: number } = {},
) {
  const limit = Math.min(options.limit ?? 200, 200);

  return db
    .select({
      endorsementNumber: endorsements.endorsementNumber,
      policyNumber: policies.policyNumber,
      customerName: customers.fullName,
      type: endorsements.type,
      status: endorsements.status,
      requestedAt: endorsements.requestedAt,
      effectiveDate: endorsements.effectiveDate,
      premiumDelta: endorsements.premiumDelta,
      branch: branches.name,
    })
    .from(endorsements)
    .innerJoin(policies, eq(policies.id, endorsements.policyId))
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .innerJoin(branches, eq(branches.id, policies.branchId))
    .where(
      inArray(endorsements.status, [
        "requested",
        "documents_pending",
        "under_review",
        "approved",
      ]),
    )
    .orderBy(desc(endorsements.requestedAt))
    .limit(limit);
}

export async function getExpiringPolicies(
  db: Database,
  options: {
    from?: Date;
    days?: number;
    minimumPremium?: number;
    limit?: number;
  } = {},
) {
  const from = startOfDay(options.from ?? new Date());
  const to = addDays(from, options.days ?? 15);
  const minimumPremium = options.minimumPremium ?? 20_000;
  const limit = Math.min(options.limit ?? 200, 500);

  return db
    .select({
      policyNumber: policies.policyNumber,
      customerName: customers.fullName,
      expiryDate: policies.expiryDate,
      premium: policies.totalPremium,
      relationshipManager: relationshipManagers.fullName,
      branch: branches.name,
      renewalStatus: renewals.status,
      propensityScore: renewals.propensityScore,
    })
    .from(policies)
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .innerJoin(branches, eq(branches.id, policies.branchId))
    .innerJoin(
      relationshipManagers,
      eq(relationshipManagers.id, policies.relationshipManagerId),
    )
    .leftJoin(renewals, eq(renewals.policyId, policies.id))
    .where(
      and(
        between(policies.expiryDate, from, to),
        gt(policies.totalPremium, minimumPremium),
        inArray(policies.status, ["active", "expired"]),
      ),
    )
    .orderBy(asc(policies.expiryDate), desc(policies.totalPremium))
    .limit(limit);
}

export async function getCurrentMonthClaimsByBranch(
  db: Database,
  options: { asOf?: Date; minimumClaimAmount?: number } = {},
) {
  const asOf = options.asOf ?? new Date();
  const from = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const to = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);

  return db
    .select({
      branch: branches.name,
      claimCount: count(claims.id),
      claimedAmount: sum(claims.claimedAmount),
      averageClaimAmount: sql<number>`round(avg(${claims.claimedAmount}), 2)`,
    })
    .from(claims)
    .innerJoin(branches, eq(branches.id, claims.branchId))
    .where(
      and(
        between(claims.intimationDate, from, to),
        gt(claims.claimedAmount, options.minimumClaimAmount ?? 50_000),
      ),
    )
    .groupBy(branches.id, branches.name)
    .orderBy(desc(sum(claims.claimedAmount)));
}

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}
