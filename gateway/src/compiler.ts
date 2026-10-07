import { insuranceSemanticCatalog } from "../../lib/catalog/semantic.js";
import { validateAnalysis } from "../../lib/gateway/analysis.js";
import type { GatewayQueryPlan } from "../../lib/gateway/contract.js";

export type QueryParameter = string | number | string[];
export type CompiledQuery = { text: string; values: QueryParameter[] };

type EntityCatalog = {
  source: string;
  from: string;
  fields: Record<string, string>;
  filters: Record<string, string>;
  sorts: Record<string, string>;
  orderBy: string;
};

const catalog: Record<GatewayQueryPlan["entity"], EntityCatalog> = {
  policies: {
    source: "policies_read_replica",
    from: `policies p
      INNER JOIN customers c ON c.id = p.customer_id
      INNER JOIN products pr ON pr.id = p.product_id
      INNER JOIN branches b ON b.id = p.branch_id
      INNER JOIN relationship_managers rm ON rm.id = p.relationship_manager_id
      LEFT JOIN renewals rn ON rn.policy_id = p.id`,
    fields: {
      policy_number: "p.policy_number AS policy_number",
      customer_name: "c.full_name AS customer_name",
      product: "pr.name AS product",
      branch: "b.name AS branch",
      relationship_manager: "rm.full_name AS relationship_manager",
      start_date: "p.start_date::text AS start_date",
      expiry_date: "p.expiry_date::text AS expiry_date",
      total_premium: "p.total_premium::float8 AS total_premium",
      status: "p.status::text AS status",
      renewal_status: "rn.status::text AS renewal_status",
      propensity_score: "rn.propensity_score::float8 AS propensity_score",
    },
    filters: {
      start_date: "p.start_date",
      expiry_date: "p.expiry_date",
      total_premium: "p.total_premium",
      status: "p.status::text",
      product: "pr.name",
      branch: "b.name",
      relationship_manager: "rm.full_name",
      renewal_status: "rn.status::text",
      propensity_score: "rn.propensity_score",
    },
    sorts: {
      policy_number: "p.policy_number",
      customer_name: "c.full_name",
      product: "pr.name",
      branch: "b.name",
      relationship_manager: "rm.full_name",
      start_date: "p.start_date",
      expiry_date: "p.expiry_date",
      total_premium: "p.total_premium",
      status: "p.status::text",
      renewal_status: "rn.status::text",
      propensity_score: "rn.propensity_score",
    },
    orderBy: "p.expiry_date ASC, p.total_premium DESC",
  },
  claims: {
    source: "claims_read_replica",
    from: `claims cl
      INNER JOIN policies p ON p.id = cl.policy_id
      INNER JOIN customers c ON c.id = p.customer_id
      INNER JOIN branches b ON b.id = cl.branch_id`,
    fields: {
      claim_number: "cl.claim_number AS claim_number",
      policy_number: "p.policy_number AS policy_number",
      customer_name: "c.full_name AS customer_name",
      branch: "b.name AS branch",
      intimation_date: "cl.intimation_date::text AS intimation_date",
      claimed_amount: "cl.claimed_amount::float8 AS claimed_amount",
      approved_amount: "cl.approved_amount::float8 AS approved_amount",
      status: "cl.status::text AS status",
      cause: "cl.cause AS cause",
    },
    filters: {
      intimation_date: "cl.intimation_date",
      claimed_amount: "cl.claimed_amount",
      approved_amount: "cl.approved_amount",
      status: "cl.status::text",
      branch: "b.name",
      cause: "cl.cause",
    },
    sorts: {
      claim_number: "cl.claim_number",
      policy_number: "p.policy_number",
      customer_name: "c.full_name",
      branch: "b.name",
      intimation_date: "cl.intimation_date",
      claimed_amount: "cl.claimed_amount",
      approved_amount: "cl.approved_amount",
      status: "cl.status::text",
      cause: "cl.cause",
    },
    orderBy: "cl.claimed_amount DESC, cl.intimation_date DESC",
  },
  endorsements: {
    source: "endorsements_read_replica",
    from: `endorsements e
      INNER JOIN policies p ON p.id = e.policy_id
      INNER JOIN customers c ON c.id = p.customer_id
      INNER JOIN branches b ON b.id = p.branch_id`,
    fields: {
      endorsement_number: "e.endorsement_number AS endorsement_number",
      policy_number: "p.policy_number AS policy_number",
      customer_name: "c.full_name AS customer_name",
      type: "e.type::text AS type",
      status: "e.status::text AS status",
      requested_at: "e.requested_at::text AS requested_at",
      effective_date: "e.effective_date::text AS effective_date",
      premium_delta: "e.premium_delta::float8 AS premium_delta",
      branch: "b.name AS branch",
    },
    filters: {
      status: "e.status::text",
      type: "e.type::text",
      requested_at: "e.requested_at",
      effective_date: "e.effective_date",
      premium_delta: "e.premium_delta",
      branch: "b.name",
    },
    sorts: {
      endorsement_number: "e.endorsement_number",
      policy_number: "p.policy_number",
      customer_name: "c.full_name",
      type: "e.type::text",
      status: "e.status::text",
      requested_at: "e.requested_at",
      effective_date: "e.effective_date",
      premium_delta: "e.premium_delta",
      branch: "b.name",
    },
    orderBy: "e.requested_at DESC",
  },
};

export function compileQuery(plan: GatewayQueryPlan): CompiledQuery {
  const entity = catalog[plan.entity];
  if (plan.source !== entity.source) {
    throw new Error("The query source does not match the approved entity.");
  }

  const selections = plan.fields.map((field) => {
    const expression = entity.fields[field];
    if (!expression) throw new Error(`Unknown selected field: ${field}`);
    return expression;
  });
  const values: QueryParameter[] = [];
  const predicates = plan.filters.map((filter) => {
    const expression = dateExpression(plan.entity, filter.field, entity.filters[filter.field]);
    if (!expression) throw new Error(`Unknown filter field: ${filter.field}`);

    if (filter.operator === "current_month") {
      return `${expression} >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) AND ${expression} < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) + INTERVAL '1 month'`;
    }
    if (filter.operator === "between") {
      if (typeof filter.value !== "string") {
        throw new Error("Between filters require a date range string.");
      }
      const [from, to, extra] = filter.value.split("..");
      if (extra || !isDateOnly(from) || !isDateOnly(to)) {
        throw new Error("Between filters require YYYY-MM-DD..YYYY-MM-DD.");
      }
      values.push(from, to);
      return `${expression} BETWEEN $${values.length - 1}::date AND $${values.length}::date`;
    }
    if (filter.operator === "greater_than") {
      if (typeof filter.value !== "number" || !Number.isFinite(filter.value)) {
        throw new Error("Greater-than filters require a finite number.");
      }
      values.push(filter.value);
      return `${expression} > $${values.length}`;
    }
    if (filter.operator === "less_than") {
      if (typeof filter.value !== "number" || !Number.isFinite(filter.value)) {
        throw new Error("Less-than filters require a finite number.");
      }
      values.push(filter.value);
      return `${expression} < $${values.length}`;
    }
    if (filter.operator === "before" || filter.operator === "after") {
      if (typeof filter.value !== "string" || !isDateOnly(filter.value)) {
        throw new Error("Date comparison filters require YYYY-MM-DD.");
      }
      values.push(filter.value);
      return `${expression} ${filter.operator === "before" ? "<" : ">="} $${values.length}::date`;
    }
    if (filter.operator === "equals") {
      values.push(filter.value);
      return `${expression} = $${values.length}`;
    }
    if (filter.operator === "in") {
      if (typeof filter.value !== "string") {
        throw new Error("In filters require a comma-separated string.");
      }
      const choices = filter.value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!choices.length || choices.length > 20) {
        throw new Error("In filters require between 1 and 20 values.");
      }
      values.push(choices);
      return `${expression} = ANY($${values.length}::text[])`;
    }
    throw new Error("Unsupported filter operator.");
  });

  if (plan.analysis) {
    const semantic = insuranceSemanticCatalog.entities.find(item => item.entity === plan.entity)!;
    const { analysis, metric } = validateAnalysis(plan, semantic);
    const time = analysis.time;
    if (time) {
      values.push(time.start, time.end);
      predicates.push(`${dateExpression(plan.entity, time.field, entity.filters[time.field])} BETWEEN $${values.length - 1}::date AND $${values.length}::date`);
    }
    const measure = metric.field ? entity.sorts[metric.field] : "NULL::numeric";
    const bucket = time ? `date_trunc('${time.grain}', time_value)::date::text` : "NULL::text";
    const aggregate = metric.operation === "count" ? "COUNT(*)" : `${metric.operation === "sum" ? "SUM" : "AVG"}(measure)`;
    values.push(plan.rowLimit + 1); // Look ahead; the Gateway rejects incomplete aggregate results.
    return {
      text: `WITH source_records AS (
        SELECT DISTINCT ${entity.sorts[semantic.primaryKey]} AS record_id,
          ${measure} AS measure, ${time ? dateExpression(plan.entity, time.field, entity.filters[time.field]) : "NULL::date"} AS time_value,
          ${plan.groupBy ? entity.sorts[plan.groupBy] : "NULL::text"} AS group_value
        FROM ${entity.from}
        ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
      ) SELECT ${bucket} AS bucket, group_value::text AS "group",
        ${aggregate}::float8 AS value, COUNT(*)::int AS record_count
        FROM source_records GROUP BY 1, 2 ORDER BY 1, 2 LIMIT $${values.length}`,
      values,
    };
  }

  const orderBy = plan.orderBy.length
    ? plan.orderBy
        .map((sort) => {
          const expression = entity.sorts[sort.field];
          if (!expression) throw new Error(`Unknown sort field: ${sort.field}`);
          return `${expression} ${sort.direction.toUpperCase()}`;
        })
        .join(", ")
    : entity.orderBy;
  values.push(plan.rowLimit);
  return {
    text: `SELECT ${selections.join(", ")}
      FROM ${entity.from}
      ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${values.length}`,
    values,
  };
}

export function compileCatalogProbe(options: {
  entity: GatewayQueryPlan["entity"];
  source: string;
  fields: string[];
}): CompiledQuery {
  const entity = catalog[options.entity];
  if (options.source !== entity.source) {
    throw new Error("The catalog source does not match the approved entity.");
  }
  const selections = options.fields.map((field) => {
    const expression = entity.fields[field];
    if (!expression) throw new Error(`Unknown catalog field: ${field}`);
    return expression;
  });
  return {
    text: `SELECT ${selections.join(", ")}
      FROM ${entity.from}
      LIMIT 0`,
    values: [],
  };
}

function isDateOnly(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function dateExpression(entity: GatewayQueryPlan["entity"], field: string, expression: string) {
  // requested_at is the adapter's only timestamp; business dates use UTC calendar days.
  return entity === "endorsements" && field === "requested_at" ? `(${expression} AT TIME ZONE 'UTC')::date` : expression;
}
