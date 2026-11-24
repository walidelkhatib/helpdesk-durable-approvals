/**
 * Runs a real Restate server and the real ticketApproval service as child
 * processes, on their own ports and in a temp directory, so tests can kill
 * and restart either of them like a crash would.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { registerDeployment } from "../../src/restate/register";

const root = path.resolve(import.meta.dirname, "../..");
// The native binary, not the npm wrapper script: SIGKILL on the wrapper would
// leave the real server running.
const restateServerBin = createRequire(import.meta.url).resolve(
  `@restatedev/restate-server-${os.platform()}-${os.arch()}/bin/restate-server`,
);

export const ports = { ingress: 28080, admin: 29070, fabric: 25122, service: 29080 };

export class RestateHarness {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), "durable-approvals-"));
  readonly ticketStore = path.join(this.dir, "tickets.json");
  private restate?: ChildProcess;
  private service?: ChildProcess;

  constructor() {
    // The test process uses the same client code as the Next.js app.
    process.env.RESTATE_INGRESS_URL = `http://localhost:${ports.ingress}`;
    process.env.RESTATE_ADMIN_URL = `http://localhost:${ports.admin}`;
    process.env.TICKET_STORE_PATH = this.ticketStore;
  }

  async startRestate() {
    if (await fetch(`http://localhost:${ports.admin}/health`).then(() => true, () => false)) {
      throw new Error(`Port ${ports.admin} is in use: is another Restate server running?`);
    }
    this.restate = spawn(
      restateServerBin,
      ["--no-logo", "--listen-mode", "tcp", "--base-dir", path.join(this.dir, "restate")],
      {
        env: {
          ...process.env,
          DO_NOT_TRACK: "1",
          RESTATE_BIND_PORT: String(ports.fabric),
          RESTATE_ADMIN__BIND_PORT: String(ports.admin),
          RESTATE_INGRESS__BIND_PORT: String(ports.ingress),
          RESTATE_LOG_FILTER: "warn",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    await waitUntil(async () => {
      const [admin, ingress] = await Promise.all([
        fetch(`http://localhost:${ports.admin}/health`).then((r) => r.ok, () => false),
        fetch(`http://localhost:${ports.ingress}/restate/health`).then((r) => r.ok, () => false),
      ]);
      return admin && ingress;
    }, 30_000, "Restate server to start");
  }

  /** SIGKILL: no graceful shutdown, like a crash. */
  async killRestate() {
    await kill(this.restate);
    this.restate = undefined;
  }

  async startService(extraEnv: Record<string, string> = {}) {
    const child = spawn(process.execPath, ["--import", "tsx", "src/restate/serve.ts"], {
      cwd: root,
      env: {
        ...process.env,
        SERVICE_PORT: String(ports.service),
        TICKET_STORE_PATH: this.ticketStore,
        FAULT_MARKER_DIR: path.join(this.dir, "faults"),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (d) => {
      const line = String(d);
      if (line.includes("[fault]")) process.stdout.write(`  service: ${line}`);
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on("data", (d) => String(d).includes("listening on") && resolve());
      child.once("exit", (code) => reject(new Error(`service exited early (${code})`)));
    });
    this.service = child;
    return child;
  }

  async killService() {
    await kill(this.service);
    this.service = undefined;
  }

  register() {
    return registerDeployment(
      `http://localhost:${ports.admin}`,
      `http://localhost:${ports.service}`,
    );
  }

  async stopAll() {
    await this.killService();
    await this.killRestate();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

async function kill(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await exited;
}

export async function waitUntil(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  what: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
