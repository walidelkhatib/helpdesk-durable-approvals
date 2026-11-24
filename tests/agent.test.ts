/**
 * The agent side, without a real model or a Restate server.
 *
 * A scripted mock model "decides" to call create_ticket. We run the same
 * request the browser sends, with a fake proposer standing in for Restate,
 * and check that:
 *   - create_ticket only PROPOSES: it starts one approval and creates no ticket
 *   - arguments that fail the Zod schema never reach Restate
 *
 * The durable part (approve, reject, crash, timeout) is in
 * durable-approvals.test.ts. Run everything with: npm test
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed tool parts */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createAgentUIStreamResponse,
  parseJsonEventStream,
  readUIMessageStream,
  simulateReadableStream,
  uiMessageChunkSchema,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { HelpdeskUIMessage } from "../src/lib/agent";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TicketInput } from "../src/lib/ticket-schema";

// Use an empty, throwaway ticket store.
process.env.TICKET_STORE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-")),
  "tickets.json",
);

let agentModule: typeof import("../src/lib/agent");
let store: typeof import("../src/lib/ticket-store");
before(async () => {
  agentModule = await import("../src/lib/agent");
  store = await import("../src/lib/ticket-store");
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** One scripted model turn: either a tool call or a text reply. */
type Turn = { toolCall: Record<string, unknown> } | { text: string };

function mockModel(turns: Turn[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const turn = turns[Math.min(call++, turns.length - 1)];
      const chunks: LanguageModelV4StreamPart[] =
        "toolCall" in turn
          ? [
              {
                type: "tool-call" as const,
                toolCallId: `call-${call}`,
                toolName: "create_ticket",
                input: JSON.stringify(turn.toolCall),
              },
              { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
            ]
          : [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: turn.text },
              { type: "text-end" as const, id: "t" },
              { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
            ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

/** POST-equivalent: run the agent on the messages and rebuild the assistant message from the stream. */
async function runTurn(
  agent: ReturnType<typeof agentModule.createHelpdeskAgent>,
  messages: HelpdeskUIMessage[],
): Promise<HelpdeskUIMessage[]> {
  const response = await createAgentUIStreamResponse({ agent, uiMessages: messages });
  const chunks = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(result, controller) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    }),
  );
  let final: HelpdeskUIMessage | undefined;
  for await (const msg of readUIMessageStream<HelpdeskUIMessage>({ stream: chunks })) {
    final = msg;
  }
  return [...messages, final!];
}

function ticketPart(messages: HelpdeskUIMessage[]) {
  const part = messages.at(-1)!.parts.find((p) => p.type === "tool-create_ticket");
  assert.ok(part, "expected a create_ticket part");
  return part as Extract<HelpdeskUIMessage["parts"][number], { type: "tool-create_ticket" }>;
}

/** Stands in for Restate: records what would have been submitted. */
function fakeProposer() {
  const proposed: TicketInput[] = [];
  return {
    proposed,
    proposeTicket: async (ticket: TicketInput) => {
      proposed.push(ticket);
      return { requestId: `req-${proposed.length}`, timeoutSeconds: 120 };
    },
  };
}

const userMessage = (text: string): HelpdeskUIMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const vpnTicket = {
  category: "network",
  priority: "high",
  summary: "VPN won't connect since this morning",
  details: "User reports the VPN client fails to connect since this morning.",
};

test("create_ticket only proposes: one approval workflow is started and no ticket is created", async () => {
  const fake = fakeProposer();
  const agent = agentModule.createHelpdeskAgent(
    mockModel([{ toolCall: vpnTicket }, { text: "Your ticket is waiting for approval." }]),
    fake,
  );

  const messages = await runTurn(agent, [userMessage("My VPN won't connect. High priority.")]);
  const part = ticketPart(messages) as any;
  assert.equal(part.state, "output-available");
  assert.deepEqual(part.output, { requestId: "req-1", status: "pending_approval", timeoutSeconds: 120 });
  assert.deepEqual(fake.proposed, [vpnTicket]);
  assert.equal(store.listTickets().length, 0, "the agent must never create a ticket itself");
  console.log("  propose →", part.output);
});

test("invalid arguments fail schema validation and never reach Restate", async () => {
  const fake = fakeProposer();
  const agent = agentModule.createHelpdeskAgent(
    mockModel([{ toolCall: { ...vpnTicket, category: "printer" } }, { text: "Sorry, let me fix that." }]),
    fake,
  );

  const messages = await runTurn(agent, [userMessage("Printer is broken")]);
  const part = ticketPart(messages);
  assert.equal(part.state, "output-error");
  assert.equal(fake.proposed.length, 0);
  console.log("  invalid →", (part as any).errorText.slice(0, 80));
});
