import type { TicketInput } from "../lib/ticket-schema";

/** Input to the ticketApproval workflow. Journaled by Restate on submit. */
export type ApprovalRequest = {
  ticket: TicketInput;
  /** How long to wait for a human before expiring the request. */
  timeoutSeconds: number;
};

export type Decision = { approved: boolean; reason?: string };

export type ApprovalStatus =
  | "pending" // waiting for a human
  | "approved" // approved, ticket being created
  | "created" // ticket exists
  | "rejected" // a human said no: no ticket
  | "expired"; // nobody answered in time: no ticket

/** The workflow's K/V state. The UI reads it to show approvals. */
export type ApprovalRecord = {
  requestId: string;
  ticket: TicketInput;
  status: ApprovalStatus;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  decidedAt?: number;
  reason?: string;
  ticketId?: string;
};

export type DecideResult = {
  /** false if a decision was already recorded (or the request expired). */
  accepted: boolean;
  status: ApprovalStatus;
};

export const WORKFLOW_NAME = "ticketApproval";
