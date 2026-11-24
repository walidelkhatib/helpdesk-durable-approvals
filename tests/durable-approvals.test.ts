/**
 * The three demos, against a real Restate server and the real service:
 *   1. crash and resume: kill everything while an approval waits, restart,
 *      approve → exactly one ticket. Also a crash in the middle of the
 *      ticket step itself.
 *   2. double approval → exactly one ticket.
 *   3. timeout → the request expires and no ticket is created.
 *
 * No model and no API key needed. Run with: npm run test:durable
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { RestateHarness, waitUntil } from "./helpers/restate-harness";
import type { ApprovalStatus } from "../src/restate/types";
import type { TicketApproval } from "../src/restate/ticket-approval";
import type { TicketInput } from "../src/lib/ticket-schema";

const h = new RestateHarness();
// Imported after the harness has pointed the app's client at the test server.
let approvals: typeof import("../src/lib/approvals");
let store: typeof import("../src/lib/ticket-store");

before(async () => {
  approvals = await import("../src/lib/approvals");
  store = await import("../src/lib/ticket-store");
  await h.startRestate();
  await h.startService();
  await h.register();
});
after(() => h.stopAll());

const vpnTicket: TicketInput = {
  category: "network",
  priority: "high",
  summary: "VPN won't connect since this morning",
  details: "User reports the VPN client fails to connect since this morning.",
};

const ticketsFor = (requestId: string) =>
  store.listTickets().filter((t) => t.requestId === requestId);

async function waitForStatus(requestId: string, status: ApprovalStatus, timeoutMs = 20_000) {
  await waitUntil(
    async () => (await approvals.getApproval(requestId).catch(() => null))?.status === status,
    timeoutMs,
    `${requestId} to be ${status}`,
  );
  return (await approvals.getApproval(requestId))!;
}

test("1a. crash and resume: kill the service AND Restate while waiting, restart, approve → one ticket", async () => {
  const { requestId } = await approvals.proposeTicket(vpnTicket);
  await waitForStatus(requestId, "pending");
  console.log(`  proposed ${requestId}: pending`);

  await h.killService();
  await h.killRestate();
  console.log("  killed the service and the Restate server (SIGKILL)");

  await h.startRestate();
  await h.startService();
  console.log("  restarted both");

  // The pending approval is still there: it lives in Restate's durable log.
  const listed = await approvals.listApprovals();
  assert.equal(listed.find((a) => a.requestId === requestId)?.status, "pending");
  assert.equal(ticketsFor(requestId).length, 0, "no ticket before approval");

  const res = await approvals.decide(requestId, { approved: true });
  assert.equal(res.accepted, true);
  const done = await waitForStatus(requestId, "created");
  assert.equal(ticketsFor(requestId).length, 1);
  console.log(`  approved after restart → ${done.ticketId}, tickets for request: 1`);
});

test("1b. crash mid-step: the process dies right after writing the ticket → still one ticket", async () => {
  // Restart the service with the demo fault turned on.
  await h.killService();
  const faulty = await h.startService({ FAULT_CRASH_AFTER_TICKET_WRITE: "1" });
  const crashed = new Promise<number | null>((r) => faulty.once("exit", r));

  const { requestId } = await approvals.proposeTicket(vpnTicket);
  await waitForStatus(requestId, "pending");
  await approvals.decide(requestId, { approved: true });

  const code = await crashed;
  assert.equal(code, 1, "service should have crashed inside the ticket step");
  assert.equal(ticketsFor(requestId).length, 1, "the ticket was written before the crash");
  console.log("  service crashed inside ctx.run, after the write and before Restate recorded it");

  // Restate retries the unfinished step on the new process; the idempotency
  // key (the request ID) makes createTicket return the existing ticket.
  await h.startService({ FAULT_CRASH_AFTER_TICKET_WRITE: "1" });
  const done = await waitForStatus(requestId, "created");
  assert.equal(ticketsFor(requestId).length, 1, "the retry must not create a second ticket");
  console.log(`  step retried on the restarted service → ${done.ticketId}, tickets for request: 1`);

  await h.killService();
  await h.startService();
});

test("2. double approval: three concurrent Approves, a late Approve and a resubmit → one ticket", async () => {
  const { requestId } = await approvals.proposeTicket(vpnTicket);
  await waitForStatus(requestId, "pending");

  const results = await Promise.all([
    approvals.decide(requestId, { approved: true }),
    approvals.decide(requestId, { approved: true }),
    approvals.decide(requestId, { approved: true }),
  ]);
  const accepted = results.filter((r) => r.accepted).length;
  assert.equal(accepted, 1, "exactly one decision is accepted");
  console.log("  concurrent decide results:", results.map((r) => r.accepted));

  await waitForStatus(requestId, "created");
  const late = await approvals.decide(requestId, { approved: true });
  assert.deepEqual(late, { accepted: false, status: "created" });

  // Retrying the submission with the same workflow ID doesn't start a second run.
  const { connect } = await import("@restatedev/restate-sdk-clients");
  const resubmit = await connect({ url: process.env.RESTATE_INGRESS_URL! })
    .workflowClient<TicketApproval>({ name: "ticketApproval" }, requestId)
    .workflowSubmit({ ticket: vpnTicket, timeoutSeconds: 120 });
  assert.equal(resubmit.status, "PreviouslyAccepted");

  assert.equal(ticketsFor(requestId).length, 1);
  console.log(`  late Approve → ${JSON.stringify(late)}; resubmit → ${resubmit.status}; tickets for request: 1`);
});

test("3. timeout: nobody answers (and the service is down meanwhile) → expired, no ticket", async () => {
  process.env.APPROVAL_TIMEOUT_SECONDS = "3";
  const { requestId } = await approvals.proposeTicket(vpnTicket);
  delete process.env.APPROVAL_TIMEOUT_SECONDS;
  await waitForStatus(requestId, "pending");

  // The timer is durable: it keeps counting in Restate with no service running.
  await h.killService();
  await new Promise((r) => setTimeout(r, 4000));
  await h.startService();

  const expired = await waitForStatus(requestId, "expired");
  assert.equal(expired.reason, "No decision within 3s");

  const late = await approvals.decide(requestId, { approved: true });
  assert.deepEqual(late, { accepted: false, status: "expired" });
  assert.equal(ticketsFor(requestId).length, 0);
  console.log(`  expired: "${expired.reason}"; late Approve → ${JSON.stringify(late)}; tickets: 0`);
});
