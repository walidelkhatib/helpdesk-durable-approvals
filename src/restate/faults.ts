/**
 * DEMO-ONLY fault injection, off unless FAULT_CRASH_AFTER_TICKET_WRITE=1.
 *
 * Kills the process right after the ticket is written to the store, but
 * before Restate has recorded that the step finished: the worst moment for a
 * crash. Restate then retries the step on a new process, and the idempotency
 * key stops a second ticket. A marker file makes it crash once per request.
 */
import fs from "node:fs";
import path from "node:path";

export function maybeCrashAfterTicketWrite(requestId: string) {
  if (process.env.FAULT_CRASH_AFTER_TICKET_WRITE !== "1") return;
  const dir = path.resolve(process.env.FAULT_MARKER_DIR ?? ".data/faults");
  const marker = path.join(dir, `crashed-${requestId}`);
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString());
  console.error(`[fault] crashing after writing the ticket for ${requestId}`);
  process.exit(1);
}
