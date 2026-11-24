"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import type { HelpdeskUIMessage } from "@/lib/agent";
import { Shell, TicketCard } from "@/components/ticket-card";
import { useApprovals } from "@/components/use-approvals";

const examples = [
  "My VPN won't connect since this morning. Open a high-priority ticket.",
  "I need access to the finance shared drive.",
  "What tickets do I have open?",
];

export default function ChatPage() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  /**
   * useChat holds the conversation and streams responses from /api/chat.
   * The conversation is ephemeral; approvals are not. They live in Restate
   * and come from useApprovals, so they survive a refresh or restart.
   */
  const { messages, sendMessage, status, error } = useChat<HelpdeskUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const { approvals, error: approvalsError, decide } = useApprovals();
  const byId = new Map(approvals.map((a) => [a.requestId, a]));
  const pending = approvals.filter((a) => a.status === "pending");

  const busy = status === "submitted" || status === "streaming";

  // Reasoning models can think for a while before any text or tool call
  // arrives, so keep the indicator up until something visible streams in.
  const last = messages.at(-1);
  const showThinking =
    busy &&
    (last?.role !== "assistant" ||
      !last.parts.some((p) => p.type === "text" || p.type.startsWith("tool-")));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="mx-auto grid h-dvh w-full max-w-6xl lg:grid-cols-[1fr_24rem]">
    <main className="flex h-dvh min-h-0 flex-col px-4">
      <header className="border-b border-zinc-200 py-4">
        <h1 className="text-lg font-semibold">IT Help Desk</h1>
        <p className="text-sm text-zinc-500">
          Describe the problem. The agent proposes a ticket; a durable Restate
          workflow waits for your approval, and nothing is created until you
          approve it.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">Try one of these:</p>
            {examples.map((example) => (
              <button
                key={example}
                onClick={() => send(example)}
                className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "flex justify-end" : ""}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white"
                  : "w-full space-y-3 text-sm"
              }
            >
              {message.parts.map((part, i) => {
                const key = `${message.id}-${i}`;
                switch (part.type) {
                  case "text":
                    return (
                      <p key={key} className="whitespace-pre-wrap leading-relaxed">
                        {part.text}
                      </p>
                    );

                  // Tool parts are typed as "tool-<toolName>".
                  case "tool-create_ticket":
                    // Arguments failed the Zod schema: no workflow was started.
                    if (part.state === "output-error") {
                      return (
                        <Shell key={key} tone="error" title="Invalid ticket proposal">
                          <p className="text-red-700">{part.errorText}</p>
                        </Shell>
                      );
                    }
                    if (part.state !== "output-available") {
                      return <Shell key={key} tone="neutral" title="Drafting ticket…" />;
                    }
                    // A workflow exists: show its live state from Restate.
                    return (
                      <TicketCard
                        key={key}
                        ticket={part.input}
                        approval={byId.get(part.output.requestId)}
                        onDecide={(approved) => decide(part.output.requestId, approved)}
                      />
                    );

                  case "tool-list_tickets":
                    return (
                      <p key={key} className="text-xs text-zinc-400">
                        {part.state === "output-available"
                          ? `Checked the ticket store (${part.output.tickets.length} found)`
                          : "Checking the ticket store…"}
                      </p>
                    );

                  default:
                    return null;
                }
              })}
            </div>
          </div>
        ))}

        {showThinking && (
          <p className="animate-pulse text-sm text-zinc-400">Thinking…</p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-zinc-200 py-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. My laptop won't charge"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </main>

    {/* Read from Restate on every poll: still here after a refresh or restart. */}
    <aside className="hidden min-h-0 flex-col border-l border-zinc-200 px-4 lg:flex">
      <header className="border-b border-zinc-200 py-4">
        <h2 className="text-sm font-semibold">
          Approvals{" "}
          <span className="font-normal text-zinc-500">({pending.length} pending)</span>
        </h2>
        <p className="text-xs text-zinc-500">Stored in Restate, not in this browser tab.</p>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {approvalsError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{approvalsError}</p>
        )}
        {!approvalsError && approvals.length === 0 && (
          <p className="text-xs text-zinc-500">No approval requests yet.</p>
        )}
        {approvals.map((a) => (
          <TicketCard
            key={a.requestId}
            compact
            ticket={a.ticket}
            approval={a}
            onDecide={(approved) => decide(a.requestId, approved)}
          />
        ))}
      </div>
    </aside>
    </div>
  );
}
