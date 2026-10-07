import type { SemanticEntity } from "../catalog/semantic.js";
import { gatewayAnalysisSchema, type GatewayQueryPlan } from "./contract.js";

// This validates a closed set of catalogue calculations, never executable text.
export function validateAnalysis(plan: GatewayQueryPlan, entity: SemanticEntity) {
  if (!plan.analysis) throw new Error("An analysis definition is required.");
  const analysis = gatewayAnalysisSchema.parse(plan.analysis);
  const metric = entity.metrics.find(item => item.id === analysis.metricId);
  if (!entity.analysisAllowed || !metric) throw new Error("This analytic metric is not approved.");
  const metricField = metric.field ? entity.fields.find(field => field.name === metric.field) : undefined;
  if (metric.field && (!metricField || metricField.masked || !plan.fields.includes(metric.field))) {
    throw new Error("Analysis cannot use an unavailable or masked measure.");
  }
  if (metric.operation !== "count" && (!metricField || metricField.dataType !== "number" || !metricField.aggregations.includes(metric.operation))) {
    throw new Error("This calculation is not approved for the measure.");
  }
  if (plan.groupBy) {
    const group = entity.fields.find(field => field.name === plan.groupBy);
    if (!group?.groupable || group.masked || !plan.fields.includes(group.name)) throw new Error("The analysis grouping is not approved.");
  }
  if (analysis.comparison === "previous_bucket" && !analysis.time) throw new Error("Growth requires time buckets.");
  if (analysis.time) {
    const time = analysis.time;
    const field = entity.fields.find(field => field.name === time.field);
    if (!field || field.dataType !== "date" || field.masked || !field.filterOperators.includes("between") || !plan.fields.includes(field.name)) {
      throw new Error("The analysis date is not approved.");
    }
    const start = Date.parse(time.start), end = Date.parse(time.end);
    if (start > end || end - start > 5 * 366 * 86400000) throw new Error("Use an ordered analysis period of at most five years.");
    if (analysis.comparison === "previous_bucket") {
      const first = new Date(start), after = new Date(end + 86400000);
      const aligned = time.grain === "day" || (time.grain === "week" ? first.getUTCDay() === 1 && after.getUTCDay() === 1
        : time.grain === "month" ? first.getUTCDate() === 1 && after.getUTCDate() === 1
          : first.getUTCMonth() === 0 && first.getUTCDate() === 1 && after.getUTCMonth() === 0 && after.getUTCDate() === 1);
      if (!aligned) throw new Error("Growth comparisons require complete calendar periods.");
    }
  }
  if (plan.orderBy.length) throw new Error("Analyses use chronological or category order; record sorting is not applicable.");
  return { analysis, metric };
}

export function timeBucket(date: string, grain: "day" | "week" | "month" | "year") {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid analysis date.");
  if (grain === "year") value.setUTCMonth(0, 1);
  else if (grain === "month") value.setUTCDate(1);
  else if (grain === "week") value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}
