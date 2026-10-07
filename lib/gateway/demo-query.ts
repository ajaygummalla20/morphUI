import { insuranceSemanticCatalog } from "../catalog/semantic";
import { timeBucket, validateAnalysis } from "./analysis";
import type { GatewayQueryPlan } from "./contract";

// Match the read-only PostgreSQL adapter's operators. Selection happens last so
// filters and sorting can use approved columns absent from the displayed table.
export function queryDemoRows(
  rows: Array<Record<string, unknown>>,
  plan: GatewayQueryPlan,
  now = new Date(),
) {
  const month = now.toISOString().slice(0, 7);
  const entity = insuranceSemanticCatalog.entities.find(item => item.entity === plan.entity)!;
  const dateFields = new Set(entity.fields.filter(field=>field.dataType === "date").map(field=>field.name));
  const dateValue = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0,10) : "";
  const matching = rows.filter((row) => plan.filters.every((filter) => {
    const value = dateFields.has(filter.field) ? dateValue(row[filter.field]) : row[filter.field];
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
  }));
  if (plan.analysis) {
    const {analysis, metric} = validateAnalysis(plan, entity);
    const groups = new Map<string, {bucket: string|null; group: string|null; values: number[]; count: number}>();
    for (const row of matching) {
      const date = analysis.time ? dateValue(row[analysis.time.field]) : null;
      if (analysis.time && (!date || date < analysis.time.start || date > analysis.time.end)) continue;
      const bucket = analysis.time ? timeBucket(date!, analysis.time.grain) : null;
      const group = plan.groupBy ? String(row[plan.groupBy] ?? "Unknown") : null;
      const key = JSON.stringify([bucket, group]);
      const current = groups.get(key) ?? {bucket, group, values: [], count: 0};
      current.count++;
      if (metric.field && typeof row[metric.field] === "number") current.values.push(row[metric.field] as number);
      groups.set(key,current);
    }
    return [...groups.values()].sort((a,b) => String(a.bucket).localeCompare(String(b.bucket)) || String(a.group).localeCompare(String(b.group))).slice(0,plan.rowLimit+1).map(item => ({
      bucket: item.bucket, group: item.group, record_count: item.count,
      value: metric.operation === "count" ? item.count : metric.operation === "average" ? item.values.length ? item.values.reduce((a,b)=>a+b,0)/item.values.length : null : item.values.length ? item.values.reduce((a,b)=>a+b,0) : null,
    }));
  }
  return matching.sort((first, second) => {
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
