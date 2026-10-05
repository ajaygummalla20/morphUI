import type { GatewayQueryPlan } from "./contract";

// Match the read-only PostgreSQL adapter's operators. Selection happens last so
// filters and sorting can use approved columns absent from the displayed table.
export function queryDemoRows(
  rows: Array<Record<string, unknown>>,
  plan: GatewayQueryPlan,
  now = new Date(),
) {
  const month = now.toISOString().slice(0, 7);
  return rows.filter((row) => plan.filters.every((filter) => {
    const value = row[filter.field];
    if (value === null || value === undefined) return false;
    const target = filter.value;
    switch (filter.operator) {
      case "equals": return value === target;
      case "in": return typeof target === "string" && target.split(",").map((item) => item.trim()).includes(String(value));
      case "greater_than": return typeof value === "number" && typeof target === "number" && value > target;
      case "less_than": return typeof value === "number" && typeof target === "number" && value < target;
      case "before": return typeof value === "string" && typeof target === "string" && value < target;
      case "after": return typeof value === "string" && typeof target === "string" && value >= target;
      case "current_month": return typeof value === "string" && value.slice(0, 7) === month;
      case "between": {
        if (typeof value !== "string" || typeof target !== "string") return false;
        const [from, to, extra] = target.split("..");
        return !extra && Boolean(from && to) && value >= from && value <= to;
      }
    }
  })).sort((first, second) => {
    for (const sort of plan.orderBy) {
      const a = first[sort.field];
      const b = second[sort.field];
      // PostgreSQL defaults to NULLS LAST for ASC and NULLS FIRST for DESC.
      const comparison = a == null ? (b == null ? 0 : 1) : b == null ? -1
        : typeof a === "number" && typeof b === "number" ? a - b
        : String(a).localeCompare(String(b));
      if (comparison) return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  }).slice(0, plan.rowLimit).map((row) =>
    Object.fromEntries(plan.fields.map((field) => [field, row[field] ?? null])),
  );
}
