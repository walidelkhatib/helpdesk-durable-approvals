"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovalRecord } from "@/restate/types";

/**
 * Polls /api/approvals, which reads the approvals from Restate.
 * Nothing about an approval is stored in the browser, so a page refresh (or
 * an app server restart) shows exactly what Restate holds.
 */
export function useApprovals(intervalMs = 1500) {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setApprovals(body.approvals);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  const decide = useCallback(
    async (requestId: string, approved: boolean) => {
      await fetch(`/api/approvals/${encodeURIComponent(requestId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          approved ? { approved } : { approved, reason: "Rejected by the user" },
        ),
      });
      await refresh();
    },
    [refresh],
  );

  return { approvals, error, decide };
}
