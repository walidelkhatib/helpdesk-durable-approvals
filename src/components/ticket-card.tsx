"use client";

import { useEffect, useState } from "react";
import type { TicketInput } from "@/lib/ticket-schema";
import type { ApprovalRecord } from "@/restate/types";

const priorityStyles = {
  low: "bg-zinc-100 text-zinc-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-700",
} as const;

/**
 * One proposed ticket and its approval, as Restate reports it:
 * pending (Approve / Reject, with a countdown) → created, rejected or expired.
 */
export function TicketCard({
  ticket,
  approval,
  onDecide,
  compact = false,
}: {
  ticket: TicketInput;
  approval?: ApprovalRecord;
  onDecide: (approved: boolean) => Promise<void>;
  compact?: boolean;
}) {
  const [sending, setSending] = useState(false);
  const status = approval?.status;

  const { tone, title } = (() => {
    switch (status) {
      case undefined:
        return { tone: "neutral", title: "Submitting for approval…" } as const;
      case "pending":
        return { tone: "pending", title: "Waiting for approval" } as const;
      case "approved":
        return { tone: "pending", title: "Approved. Creating ticket…" } as const;
      case "created":
        return { tone: "success", title: `Ticket created: ${approval!.ticketId}` } as const;
      case "rejected":
        return { tone: "muted", title: "Rejected: nothing was created" } as const;
      case "expired":
        return { tone: "muted", title: "Expired: nothing was created" } as const;
    }
  })();

  async function respond(approved: boolean) {
    setSending(true);
    try {
      await onDecide(approved);
    } finally {
      setSending(false);
    }
  }

  return (
    <Shell tone={tone} title={title}>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-zinc-500">Summary</dt>
        <dd className="font-medium">{ticket.summary}</dd>
        <dt className="text-zinc-500">Category</dt>
        <dd className="capitalize">{ticket.category}</dd>
        <dt className="text-zinc-500">Priority</dt>
        <dd>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${priorityStyles[ticket.priority]}`}
          >
            {ticket.priority}
          </span>
        </dd>
        {!compact && (
          <>
            <dt className="text-zinc-500">Details</dt>
            <dd className="whitespace-pre-wrap text-zinc-700">{ticket.details}</dd>
          </>
        )}
        {approval?.reason && (
          <>
            <dt className="text-zinc-500">Outcome</dt>
            <dd className="text-zinc-700">{approval.reason}</dd>
          </>
        )}
        {approval && (
          <>
            <dt className="text-zinc-500">Request</dt>
            <dd className="truncate font-mono text-xs text-zinc-500">{approval.requestId}</dd>
          </>
        )}
      </dl>

      {/* The workflow is durably waiting in Restate. Nothing has been created. */}
      {status === "pending" && (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={sending}
            onClick={() => respond(true)}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            disabled={sending}
            onClick={() => respond(false)}
            className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            Reject
          </button>
          <Countdown until={approval!.expiresAt} />
        </div>
      )}
    </Shell>
  );
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((until - now) / 1000));
  return (
    <span className="ml-auto text-xs tabular-nums text-zinc-500">
      expires in {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

const tones = {
  neutral: "border-zinc-200 bg-zinc-50",
  pending: "border-amber-300 bg-amber-50/60",
  success: "border-emerald-300 bg-emerald-50/60",
  muted: "border-zinc-200 bg-zinc-50 opacity-70",
  error: "border-red-300 bg-red-50",
} as const;

export function Shell({
  tone,
  title,
  children,
}: {
  tone: keyof typeof tones;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 text-sm ${tones[tone]}`}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-600">
        {title}
      </p>
      {children}
    </div>
  );
}
