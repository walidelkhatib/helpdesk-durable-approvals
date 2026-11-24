import {
  ToolLoopAgent,
  isStepCount,
  tool,
  type InferAgentUIMessage,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { proposeTicket as restateProposeTicket } from "./approvals";
import { createTicketInput, type TicketInput } from "./ticket-schema";
import { listTickets } from "./ticket-store";

export { createTicketInput };

/** Starts a durable approval for a proposed ticket. Injectable for tests. */
export type ProposeTicket = (
  ticket: TicketInput,
) => Promise<{ requestId: string; timeoutSeconds: number }>;

/**
 * TOOLS ARE DEFINED HERE.
 *
 * Each tool has a Zod `inputSchema`. The AI SDK checks the model's proposed
 * arguments against it before anything runs. If the model proposes an
 * invalid category or an empty summary, the call fails validation, `execute`
 * never runs, and the error goes back to the model (and shows in the UI).
 */
function createTools(proposeTicket: ProposeTicket) {
  return {
    create_ticket: tool({
      description:
        "Propose an IT help desk ticket. This submits it for human approval; it does NOT create the ticket.",
      inputSchema: createTicketInput,
      /**
       * THE MODEL CAN ONLY PROPOSE.
       *
       * This starts a Restate ticketApproval workflow and returns at once.
       * The ticket is created later, by the workflow, and only if a human
       * approves in time. There is no tool that creates a ticket directly.
       */
      execute: async (input) => {
        const { requestId, timeoutSeconds } = await proposeTicket(input);
        return { requestId, status: "pending_approval" as const, timeoutSeconds };
      },
    }),

    list_tickets: tool({
      description:
        "List all existing tickets with their IDs, status, priority and summary. Always use this to answer questions about existing tickets.",
      inputSchema: z.object({}),
      // Facts about tickets always come from the store, never model memory.
      execute: async () => ({
        tickets: listTickets().map((t) => ({
          id: t.id,
          status: t.status,
          category: t.category,
          priority: t.priority,
          summary: t.summary,
          createdAt: t.createdAt,
        })),
      }),
    }),
  };
}

const instructions = `You are a concise IT help desk agent.

- You can only do two things: create tickets (create_ticket) and list tickets (list_tickets). You cannot update, close, reopen or reassign tickets, so never offer to.
- If the user asks to update or close a ticket, say you can't do that here: the IT help desk will update or close it, and they can mention the ticket ID when IT follows up. Don't create a new ticket as a workaround.

- Turn the user's request into a ticket: choose a category (network, hardware, software, access, other), a priority (low, medium, high), a short summary, and details.
- If a key detail is missing, ask at most ONE clarifying question, then propose the ticket with your best judgement.
- To create a ticket, call create_ticket. It does not create the ticket: it submits it for approval and returns status "pending_approval". Tell the user in one sentence that the ticket is waiting for approval and will expire if nobody approves it in time. Don't ask "shall I create it?" in text first.
- Never claim a ticket was created. Only list_tickets can confirm that a ticket exists; quote its ID exactly.
- Call create_ticket once per issue. Don't propose the same ticket again unless the user asks you to (for example after a rejection or an expiry).
- For ANY question about existing tickets, call list_tickets. Never answer from conversation memory.
- One ticket per issue. Before proposing a ticket, check with list_tickets whether an open ticket already covers the same problem. If it does, don't propose another one: tell the user the existing ticket ID covers it and that IT will follow up there.
- Only call list_tickets when the user asks about tickets or you are checking for a duplicate. Don't mention existing tickets in replies where they aren't relevant.
- You may share general troubleshooting tips if the user asks. Say they are general suggestions that may not match their setup, and that the IT help desk will follow up on the ticket.
- Never suggest steps that weaken security or need admin rights: no disabling firewalls, antivirus or other security software, no sudo or administrator commands, no changing security settings. Leave those to IT.
- Keep replies short: one to three sentences.`;

/**
 * The agent. ToolLoopAgent runs the model, calls tools, feeds results back,
 * and repeats until the model gives a final answer (or the step limit is hit).
 *
 * The model and the proposer are parameters so tests can pass mocks.
 *
 * Unlike the browser-held version of this app, there is no AI SDK tool
 * approval here: the approval lives in a Restate workflow, outside the chat.
 */
export function createHelpdeskAgent(
  // AI Gateway model string ("provider/model"). Authenticated by
  // AI_GATEWAY_API_KEY locally, or automatically via OIDC on Vercel.
  model: LanguageModel = process.env.AI_MODEL ?? "openai/gpt-5-mini",
  { proposeTicket = restateProposeTicket }: { proposeTicket?: ProposeTicket } = {},
) {
  return new ToolLoopAgent({
    model,
    instructions,
    tools: createTools(proposeTicket),
    stopWhen: isStepCount(5),
  });
}

export const helpdeskAgent = createHelpdeskAgent();

/** Message type shared with the client, so tool parts are fully typed. */
export type HelpdeskUIMessage = InferAgentUIMessage<typeof helpdeskAgent>;
