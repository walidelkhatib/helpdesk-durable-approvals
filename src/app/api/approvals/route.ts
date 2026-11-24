import { connection } from "next/server";
import { listApprovals } from "@/lib/approvals";

/** GET /api/approvals: every approval request Restate holds, newest first. */
export async function GET() {
  await connection(); // always dynamic: the list changes as workflows progress
  try {
    return Response.json({ approvals: await listApprovals() });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "Restate isn't reachable. Is `npm run dev:all` running?" },
      { status: 503 },
    );
  }
}
