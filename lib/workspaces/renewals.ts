import { z } from "zod";

export const MAX_WORKSPACE_ROWS = 200;

export const renewalWorkspaceFilterSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "from must use YYYY-MM-DD")
      .optional(),
    days: z.coerce.number().int().min(1).max(90).default(15),
    minimumPremium: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000_000)
      .default(20_000),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_WORKSPACE_ROWS)
      .default(MAX_WORKSPACE_ROWS),
  })
  .strict();

export type RenewalWorkspaceFilters = z.infer<
  typeof renewalWorkspaceFilterSchema
>;

export type RenewalRecord = {
  policyNumber: string;
  customerName: string;
  expiryDate: string;
  premium: number;
  relationshipManager: string;
  branch: string;
  renewalStatus: string | null;
  propensityScore: number | null;
};

export type RenewalPriority = "High" | "Medium" | "Standard";

export type RenewalWorkspaceResponse = {
  workspace: {
    title: string;
    description: string;
    sourceLabel: string;
    sourceMode: "client_gateway" | "secure_demo";
    generatedInMs: number;
  };
  filters: Required<RenewalWorkspaceFilters>;
  summary: {
    renewalsDue: number;
    premiumAtRisk: number;
    highPriority: number;
    accounts: number;
  };
  trend: Array<{ date: string; premium: number }>;
  groups: Array<{
    relationshipManager: string;
    policies: number;
    premium: number;
  }>;
  rows: Array<RenewalRecord & { priority: RenewalPriority }>;
  queryPlan: {
    source: string;
    operation: "select";
    entity: "policies";
    fields: string[];
    filters: Array<{ field: string; operator: string; value: string | number }>;
    rowLimit: number;
  };
  safety: {
    readOnly: true;
    rawSqlAccepted: false;
    fieldsAccessed: number;
    permittedFields: number;
    sensitiveData: "masked";
    maximumRows: number;
    returnedRows: number;
  };
};

export function parseRenewalWorkspaceFilters(searchParams: URLSearchParams) {
  return renewalWorkspaceFilterSchema.parse(
    Object.fromEntries(searchParams.entries()),
  );
}

export function buildRenewalWorkspaceResponse(options: {
  records: RenewalRecord[];
  filters: RenewalWorkspaceFilters;
  sourceMode: RenewalWorkspaceResponse["workspace"]["sourceMode"];
  generatedInMs: number;
}): RenewalWorkspaceResponse {
  const from = parseDateOnly(options.filters.from ?? toDateOnly(new Date()));
  const filters: Required<RenewalWorkspaceFilters> = {
    from: toDateOnly(from),
    days: options.filters.days,
    minimumPremium: options.filters.minimumPremium,
    limit: Math.min(options.filters.limit, MAX_WORKSPACE_ROWS),
  };
  const records = options.records.slice(0, filters.limit);
  const rows = records.map((record) => ({
    ...record,
    priority: getRenewalPriority(record, from),
  }));
  const premiumAtRisk = roundMoney(
    rows.reduce((total, record) => total + record.premium, 0),
  );
  const accounts = new Set(rows.map((record) => record.customerName)).size;

  const trendByDate = new Map<string, number>();
  for (let day = 0; day <= filters.days; day += 1) {
    trendByDate.set(toDateOnly(addDays(from, day)), 0);
  }
  for (const row of rows) {
    trendByDate.set(
      row.expiryDate,
      roundMoney((trendByDate.get(row.expiryDate) ?? 0) + row.premium),
    );
  }

  const groups = new Map<string, { policies: number; premium: number }>();
  for (const row of rows) {
    const current = groups.get(row.relationshipManager) ?? {
      policies: 0,
      premium: 0,
    };
    current.policies += 1;
    current.premium = roundMoney(current.premium + row.premium);
    groups.set(row.relationshipManager, current);
  }

  return {
    workspace: {
      title: `Motor renewals — next ${filters.days} days`,
      description: `Policies above ${formatCurrency(filters.minimumPremium)}, grouped by relationship manager`,
      sourceLabel:
        options.sourceMode === "client_gateway"
          ? "Client-hosted Morph Gateway"
          : "Secure demonstration Gateway",
      sourceMode: options.sourceMode,
      generatedInMs: Math.max(1, Math.round(options.generatedInMs)),
    },
    filters,
    summary: {
      renewalsDue: rows.length,
      premiumAtRisk,
      highPriority: rows.filter((row) => row.priority === "High").length,
      accounts,
    },
    trend: Array.from(trendByDate, ([date, premium]) => ({ date, premium })),
    groups: Array.from(groups, ([relationshipManager, group]) => ({
      relationshipManager,
      ...group,
    })).sort((first, second) => second.premium - first.premium),
    rows,
    queryPlan: {
      source: "policies_read_replica",
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
          value: `${filters.from}..${toDateOnly(addDays(from, filters.days))}`,
        },
        {
          field: "total_premium",
          operator: "greater_than",
          value: filters.minimumPremium,
        },
      ],
      rowLimit: filters.limit,
    },
    safety: {
      readOnly: true,
      rawSqlAccepted: false,
      fieldsAccessed: 8,
      permittedFields: 8,
      sensitiveData: "masked",
      maximumRows: MAX_WORKSPACE_ROWS,
      returnedRows: rows.length,
    },
  };
}

export function createDemoRenewalRecords(
  filters: RenewalWorkspaceFilters,
): RenewalRecord[] {
  const from = parseDateOnly(filters.from ?? toDateOnly(new Date()));
  const customers = [
    "Aarav Logistics",
    "Meridian Foods",
    "Northstar Retail",
    "Vega Components",
    "Ananta Mobility",
    "Bluepeak Warehousing",
    "Cedar Health Systems",
    "Deccan Agro Supply",
    "Eastern Route Services",
    "Falcon Office Parks",
    "Greenline Distributors",
    "Horizon Textile Works",
  ];
  const managers = ["Neha Rao", "Arjun Mehta", "Kabir Shah", "Isha Nair"];
  const branches = [
    "Hyderabad Central",
    "Bengaluru Central",
    "Mumbai Central",
    "Chennai Central",
  ];
  const premiums = [
    86_400, 62_900, 41_250, 28_800, 119_500, 54_300, 22_750, 37_600,
    73_850, 31_400, 96_200, 46_700, 18_900, 24_650, 58_250, 34_900,
    81_700, 27_300, 67_450, 43_800, 102_300, 29_750, 52_100, 39_200,
  ];

  return premiums
    .map((premium, index): RenewalRecord => {
      const expiryOffset = (index % 30) + 1;
      const propensityScore = 96 - ((index * 7) % 63);
      return {
        policyNumber: `MTR-DEMO-${String(index + 1).padStart(5, "0")}`,
        customerName: customers[index % customers.length],
        expiryDate: toDateOnly(addDays(from, expiryOffset)),
        premium,
        relationshipManager: managers[index % managers.length],
        branch: branches[index % branches.length],
        renewalStatus: ["due", "contacted", "quoted", "payment_pending"][
          index % 4
        ],
        propensityScore,
      };
    })
    .filter((record) => {
      const expiry = parseDateOnly(record.expiryDate);
      return (
        expiry <= addDays(from, filters.days) &&
        record.premium > filters.minimumPremium
      );
    })
    .slice(0, filters.limit);
}

function getRenewalPriority(record: RenewalRecord, from: Date): RenewalPriority {
  const daysToExpiry = differenceInDays(parseDateOnly(record.expiryDate), from);
  const score = record.propensityScore ?? 0;
  if (daysToExpiry <= 5 || record.premium >= 80_000 || score >= 85) {
    return "High";
  }
  if (daysToExpiry <= 10 || record.premium >= 45_000 || score >= 65) {
    return "Medium";
  }
  return "Standard";
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function differenceInDays(first: Date, second: Date) {
  return Math.round((first.getTime() - second.getTime()) / 86_400_000);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
