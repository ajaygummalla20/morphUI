import assert from "node:assert/strict";
import test from "node:test";
import {
  insuranceSemanticCatalog,
  semanticCatalogSchema,
} from "../lib/catalog/semantic";
import {
  createWorkspaceQueryPlan,
  planWorkspaceRequest,
} from "../lib/workspaces/dynamic";

test("the insurance catalogue is internally consistent and versioned", () => {
  const catalog = semanticCatalogSchema.parse(insuranceSemanticCatalog);
  assert.match(catalog.catalogVersion, /^insurance-catalog-/);
  assert.deepEqual(
    catalog.entities.map((entity) => entity.entity),
    ["policies", "claims", "endorsements"],
  );
  assert.ok(
    catalog.entities.every(
      (entity) =>
        entity.fields.some((field) => field.name === entity.primaryKey) &&
        entity.metrics.length > 0,
    ),
  );
  const endorsementStatus = catalog.entities
    .find((entity) => entity.entity === "endorsements")
    ?.fields.find((field) => field.name === "status");
  assert.deepEqual(
    endorsementStatus?.valueSets.find((valueSet) => valueSet.id === "pending")?.values,
    ["requested", "documents_pending", "under_review"],
  );
});

test("the planner can use only fields and capabilities exposed by the catalogue", () => {
  const plan = planWorkspaceRequest(
    "Show the highest claims this month grouped by branch",
    insuranceSemanticCatalog,
    50,
  );
  const entity = insuranceSemanticCatalog.entities.find(
    (candidate) => candidate.entity === plan.entity,
  );
  assert.ok(entity);
  const allowedFields = new Set(entity.fields.map((field) => field.name));
  assert.ok(plan.fields.every((field) => allowedFields.has(field)));
  assert.ok(plan.filters.every((filter) => allowedFields.has(filter.field)));
  assert.ok(plan.orderBy.every((sort) => allowedFields.has(sort.field)));
  const queryPlan = createWorkspaceQueryPlan(plan);
  assert.equal(queryPlan.catalogVersion, insuranceSemanticCatalog.catalogVersion);
  assert.equal(queryPlan.operation, "select");
  assert.equal(queryPlan.rowLimit, 50);
});

test("stale or malformed catalogue relationships fail validation", () => {
  const malformed = structuredClone(insuranceSemanticCatalog);
  malformed.relationships[0].fromField = "unapproved_customer_secret";
  assert.equal(semanticCatalogSchema.safeParse(malformed).success, false);
});
