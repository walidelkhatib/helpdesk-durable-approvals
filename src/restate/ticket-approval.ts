/**
 * The ticketApproval workflow: the ONLY code path that creates a ticket.
 *
 * One workflow instance per approval request, keyed by a request ID that the
 * server generates. Restate journals every step (state writes, the wait, the
 * side effect), so if this process crashes, Restate replays the journal on a
 * fresh process and continues where it stopped, without redoing finished steps.
 */
import * as restate from "@restatedev/restate-sdk";
import { createTicketInput } from "../lib/ticket-schema";
import { createTicket } from "../lib/ticket-store";
import { maybeCrashAfterTicketWrite } from "./faults";
import {
  WORKFLOW_NAME,
  type ApprovalRecord,
  type ApprovalRequest,
  type DecideResult,
  type Decision,
} from "./types";

const STATE = "approval";
const DECISION = "decision"; // name of the workflow's durable promise

export const ticketApproval = restate.workflow({
  name: WORKFLOW_NAME,
  handlers: {
    /** Runs exactly once per request ID. */
    run: async (ctx: restate.WorkflowContext, req: ApprovalRequest) => {
      // Re-validate: anything that reaches Restate without going through the
      // agent still can't create a malformed ticket. TerminalError = no retry.
      const parsed = createTicketInput.safeParse(req.ticket);
      if (!parsed.success) {
        throw new restate.TerminalError(`Invalid ticket: ${parsed.error.message}`);
      }
      const ticket = parsed.data;

      // ctx.date.now() is journaled, so the deadline is the same on every replay.
      const createdAt = await ctx.date.now();
      const timeoutMs = req.timeoutSeconds * 1000;
      const record: ApprovalRecord = {
        requestId: ctx.key,
        ticket,
        status: "pending",
        createdAt,
        expiresAt: createdAt + timeoutMs,
      };
      ctx.set(STATE, record);

      let decision: Decision;
      try {
        // ── THE DURABLE WAIT ────────────────────────────────────────────────
        // Wait for the `decide` handler to resolve the workflow's durable
        // promise. The promise and the timer both live in Restate, not in this
        // process: while waiting, the invocation suspends and this process can
        // be killed or redeployed. When the promise resolves (or the timer
        // fires), Restate re-invokes the handler and replays to this point.
        //
        // ── THE TIMEOUT ─────────────────────────────────────────────────────
        // orTimeout() races the promise against a durable timer. Because the
        // timer is durable, it fires on time even if no process was running
        // while it was counting down.
        decision = await ctx.promise<Decision>(DECISION).get().orTimeout(timeoutMs);
      } catch (error) {
        if (error instanceof restate.TimeoutError) {
          const expired: ApprovalRecord = {
            ...record,
            status: "expired",
            decidedAt: await ctx.date.now(),
            reason: `No decision within ${req.timeoutSeconds}s`,
          };
          ctx.set(STATE, expired);
          return expired;
        }
        throw error;
      }

      const decidedAt = await ctx.date.now();
      if (!decision.approved) {
        const rejected: ApprovalRecord = {
          ...record,
          status: "rejected",
          decidedAt,
          reason: decision.reason ?? "Rejected by a human",
        };
        ctx.set(STATE, rejected);
        return rejected;
      }

      ctx.set(STATE, { ...record, status: "approved", decidedAt });

      // ── THE EXACTLY-ONCE SIDE EFFECT ──────────────────────────────────────
      // ctx.run journals the step's result. Once it has completed, a replay
      // returns the journaled ticket without calling createTicket again.
      // If the process dies *during* the step (after writing, before Restate
      // recorded the result), Restate retries the step; the idempotency key
      // (this workflow's request ID) makes the retry return the same ticket.
      const created = await ctx.run("create ticket", () => {
        const t = createTicket(ticket, { requestId: ctx.key });
        maybeCrashAfterTicketWrite(ctx.key); // demo-only fault injection
        return { id: t.id, status: t.status };
      });

      const done: ApprovalRecord = {
        ...record,
        status: "created",
        decidedAt,
        ticketId: created.id,
      };
      ctx.set(STATE, done);
      return done;
    },

    /** Approve or reject. Called by the server-side decision endpoint. */
    decide: async (
      ctx: restate.WorkflowSharedContext,
      decision: Decision,
    ): Promise<DecideResult> => {
      const current = await ctx.get<ApprovalRecord>(STATE);
      if (!current) {
        throw new restate.TerminalError("Unknown approval request", { errorCode: 404 });
      }
      // Already decided or expired: a second Approve is a no-op.
      if (current.status !== "pending") {
        return { accepted: false, status: current.status };
      }
      try {
        // A durable promise can be completed only once. If two decisions race,
        // Restate keeps the first and this resolve fails for the second.
        await ctx.promise<Decision>(DECISION).resolve(decision);
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          return { accepted: false, status: current.status };
        }
        throw error;
      }
      return { accepted: true, status: decision.approved ? "approved" : "rejected" };
    },

    /** Read the request's current state (for the UI). */
    status: async (ctx: restate.WorkflowSharedContext) =>
      (await ctx.get<ApprovalRecord>(STATE)) ?? null,
  },
  options: {
    // Keep finished approvals (state, promise, result) for a day, so the UI
    // can show outcomes and a late second Approve is still a safe no-op.
    workflowRetention: { days: 1 },
    // Retry quickly after a crash, so the demo resumes in seconds.
    retryPolicy: { initialInterval: { milliseconds: 250 }, maxInterval: { seconds: 2 } },
  },
});

export type TicketApproval = typeof ticketApproval;
