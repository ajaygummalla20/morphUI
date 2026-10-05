import { createHash } from "node:crypto";

export type GatewayAuditEvent = {
  requestId: string;
  decisionId: string;
  decision: "allow" | "deny" | "error";
  reasonCode?: string;
  organizationId: string;
  connectorId: string;
  subjectId: string;
  entity: string;
  fieldCount: number;
  rowLimit: number;
  returnedRows?: number;
  policyVersion: string;
  durationMs: number;
};

export function writeAuditEvent(event: GatewayAuditEvent, salt: string) {
  const subjectHash = createHash("sha256")
    .update(`${salt}:${event.subjectId}`)
    .digest("hex")
    .slice(0, 24);
  const { subjectId: _subjectId, ...safeEvent } = event;
  void _subjectId;
  console.log(
    JSON.stringify({
      type: "morph_gateway_audit",
      occurredAt: new Date().toISOString(),
      ...safeEvent,
      subjectHash,
    }),
  );
}
