import { z } from "zod";

/**
 * The shape of a proposed ticket.
 *
 * It is checked twice: by the AI SDK when the model calls create_ticket
 * (bad arguments never reach Restate), and again inside the Restate workflow
 * (so nothing that skips the agent can create a malformed ticket).
 */
export const createTicketInput = z.object({
  category: z.enum(["network", "hardware", "software", "access", "other"]),
  priority: z.enum(["low", "medium", "high"]),
  summary: z
    .string()
    .trim()
    .min(5, "Summary is too short")
    .max(120, "Summary must be 120 characters or fewer")
    .describe("One-line ticket title"),
  details: z
    .string()
    .trim()
    .min(1, "Details are required")
    .max(2000)
    .describe(
      "What the user reported, including when it started and what they tried",
    ),
});

export type TicketInput = z.infer<typeof createTicketInput>;
