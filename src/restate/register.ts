/**
 * Register the service endpoint with the Restate server (same as
 * `restate deployments register`), waiting for both to be up first.
 * `force` re-registers after code changes during development.
 */
const adminUrl = process.env.RESTATE_ADMIN_URL ?? "http://localhost:9070";
const serviceUrl = process.env.SERVICE_URL ?? "http://localhost:9080";

import net from "node:net";

/** Wait until something accepts TCP connections on the URL's port. */
async function waitFor(url: string, what: string) {
  const { hostname, port } = new URL(url);
  for (let i = 0; i < 120; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: hostname, port: Number(port) }, () => {
          socket.end();
          resolve();
        });
        socket.on("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${what} not reachable at ${url}`);
}

export async function registerDeployment(admin = adminUrl, service = serviceUrl) {
  await waitFor(`${admin}/health`, "Restate admin API");
  await waitFor(service, "Service endpoint");
  const res = await fetch(`${admin}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: service, force: true }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status} ${await res.text()}`);
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  registerDeployment().then(
    (d) => console.log(`Registered ${serviceUrl}:`, d.services?.map((s: { name: string }) => s.name)),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
