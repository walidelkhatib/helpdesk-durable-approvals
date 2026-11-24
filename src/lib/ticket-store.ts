/**
 * Mock ticket store: a JSON file on local disk.
 *
 * A real version would talk to ServiceNow, Jira or a database. It is a file
 * (not process memory) because two processes use it: the Restate service
 * writes tickets, and the Next.js app reads them for list_tickets. It also
 * has to survive the restarts in the crash demo.
 *
 * Every ticket records the approval request that created it (`requestId`).
 * createTicket is idempotent on that key, so if the workflow's ticket step
 * is retried after a crash, it returns the existing ticket and does not
 * create a second one.
 */
import fs from "node:fs";
import path from "node:path";
import type { TicketInput } from "./ticket-schema";

export type Ticket = TicketInput & {
  id: string; // e.g. "IT-1042"
  status: "Open";
  requestId: string; // the approval workflow that created it (idempotency key)
  createdAt: string; // ISO timestamp
};

const FIRST_TICKET_NUMBER = 1042;

function storePath() {
  const override = process.env.TICKET_STORE_PATH;
  return override
    ? path.resolve(/*turbopackIgnore: true*/ override)
    : path.join(process.cwd(), ".data", "tickets.json");
}

function read(): Ticket[] {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8")) as Ticket[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function write(tickets: Ticket[]) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write to a temp file, then rename: a crash mid-write can't corrupt the store.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tickets, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Create a ticket, or return the one this request already created.
 * Uses synchronous file IO, so calls in one process never interleave.
 */
export function createTicket(
  input: TicketInput,
  { requestId }: { requestId: string },
): Ticket {
  const tickets = read();
  const existing = tickets.find((t) => t.requestId === requestId);
  if (existing) return existing;

  const ticket: Ticket = {
    ...input,
    id: `IT-${FIRST_TICKET_NUMBER + tickets.length}`,
    status: "Open",
    requestId,
    createdAt: new Date().toISOString(),
  };
  write([...tickets, ticket]);
  return ticket;
}

export function listTickets(): Ticket[] {
  return read();
}
