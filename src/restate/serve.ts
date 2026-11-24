/**
 * The Restate service endpoint. Restate calls this over HTTP to run workflow
 * handlers. Register it once with the Restate server (npm run restate:register).
 */
import * as restate from "@restatedev/restate-sdk";
import { ticketApproval } from "./ticket-approval";

const port = Number(process.env.SERVICE_PORT ?? 9080);

restate.serve({ services: [ticketApproval], port }).then((p) => {
  console.log(`ticketApproval service listening on :${p}`);
});
