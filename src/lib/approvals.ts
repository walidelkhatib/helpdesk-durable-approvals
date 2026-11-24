/**
 * Server-side access to the ticketApproval workflow, used by the agent's
 * create_ticket tool and the /api/approvals routes. Never imported by the
 * browser: the browser only talks to /api/approvals.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { TicketApproval } from "../restate/ticket-approval";
import {
  WORKFLOW_NAME,
  type ApprovalRecord,
  type DecideResult,
  type Decision,
} from "../restate/types";
import type { TicketInput } from "./ticket-schema";

const ingressUrl = () => process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";
const adminUrl = () => process.env.RESTATE_ADMIN_URL ?? "http://localhost:9070";

/** 2 minutes for the demo; override with APPROVAL_TIMEOUT_SECONDS. */
export const approvalTimeoutSeconds = () =>
  Number(process.env.APPROVAL_TIMEOUT_SECONDS ?? 120);

function workflow(requestId: string) {
  return clients
    .connect({ url: ingressUrl() })
    .workflowClient<TicketApproval>({ name: WORKFLOW_NAME }, requestId);
}

/**
 * Start a durable approval workflow for a proposed ticket.
 * The request ID is generated here, on the server: the model and the browser
 * never choose it. Submitting the same ID twice starts only one workflow.
 */
export async function proposeTicket(ticket: TicketInput) {
  const requestId = crypto.randomUUID();
  const timeoutSeconds = approvalTimeoutSeconds();
  await workflow(requestId).workflowSubmit({ ticket, timeoutSeconds });
  return { requestId, timeoutSeconds };
}

export async function decide(requestId: string, decision: Decision): Promise<DecideResult> {
  return workflow(requestId).decide(decision);
}

export async function getApproval(requestId: string): Promise<ApprovalRecord | null> {
  return workflow(requestId).status();
}

/**
 * All approval requests Restate still holds (pending, and finished ones until
 * their retention expires). Read from Restate's SQL introspection API over the
 * workflows' K/V state, so the list lives in Restate, not in the browser.
 */
export async function listApprovals(): Promise<ApprovalRecord[]> {
  const res = await fetch(`${adminUrl()}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT value_utf8 FROM state WHERE service_name = '${WORKFLOW_NAME}' AND key = 'approval'`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Restate query failed: ${res.status} ${await res.text()}`);
  const { rows } = (await res.json()) as { rows: { value_utf8: string }[] };
  return rows
    .map((r) => JSON.parse(r.value_utf8) as ApprovalRecord)
    .sort((a, b) => b.createdAt - a.createdAt);
}
