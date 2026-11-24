import { createAgentUIStreamResponse } from "ai";
import { helpdeskAgent } from "@/lib/agent";

// Allow streamed responses to run for up to 30 seconds.
export const maxDuration = 30;

/**
 * HOW STREAMING WORKS.
 *
 * The browser (useChat) POSTs the full list of UI messages here. The agent
 * runs, and createAgentUIStreamResponse returns a streaming HTTP response:
 * text tokens, tool calls and tool results arrive at the browser as they
 * happen, and useChat merges them into `messages`.
 *
 * Approvals don't go through this route. create_ticket starts a Restate
 * workflow and returns its request ID; Approve/Reject call /api/approvals.
 */
export async function POST(request: Request) {
  const { messages } = await request.json();

  return createAgentUIStreamResponse({
    agent: helpdeskAgent,
    uiMessages: messages,
    abortSignal: request.signal,
    // Show a useful message in the chat instead of a generic error.
    onError: (error) => {
      console.error(error);
      const message = error instanceof Error ? error.message : "";
      if (error instanceof Error && error.name === "GatewayAuthenticationError") {
        return "The model isn't configured: set AI_GATEWAY_API_KEY locally, or deploy to Vercel to use OIDC.";
      }
      if (message.includes("credit card")) {
        return "AI Gateway needs a credit card on the Vercel account to unlock its free credits.";
      }
      return "Something went wrong while talking to the model. Please try again.";
    },
    // Keep schema validation errors visible to the user and the model.
    redactToolErrors: false,
  });
}
