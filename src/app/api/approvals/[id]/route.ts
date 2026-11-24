import { HttpCallError } from "@restatedev/restate-sdk-clients";
import { z } from "zod";
import { decide, getApproval } from "@/lib/approvals";

const decisionBody = z.object({
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
});

/** GET /api/approvals/:id: one request's current state. */
export async function GET(_req: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  try {
    const approval = await getApproval(id);
    if (!approval) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ approval });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/approvals/:id { approved }: the human's decision.
 *
 * This is the only way to resolve the workflow's promise from outside, and it
 * runs on the server. The browser can't mark a ticket "approved" itself; it
 * can only ask this endpoint, which forwards the decision to Restate. Posting
 * twice is safe: the workflow keeps the first decision.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  const parsed = decisionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Body must be { approved: boolean }" }, { status: 400 });
  }
  try {
    return Response.json(await decide(id, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof HttpCallError && error.status === 404) {
    return Response.json({ error: "Unknown approval request" }, { status: 404 });
  }
  console.error(error);
  return Response.json({ error: "Restate isn't reachable." }, { status: 503 });
}
