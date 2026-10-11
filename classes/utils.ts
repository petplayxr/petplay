import { PostMan } from "../submodules/stageforge/mod.ts"
import { dirname, join, extname } from "jsr:@std/path";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

/**
 * Control port of the `agentRepl` actor. Server and clients resolve it the same
 * way — `--agent-repl-port=<port>`, then `PETPLAY_AGENT_REPL_PORT`, then 3987 —
 * so a client can be pointed at a server that is not on the default port.
 */
/** Default agent-REPL port; `--agent-repl-port` / `PETPLAY_AGENT_REPL_PORT` override it. */
export const DEFAULT_AGENT_REPL_PORT = 3987;

export function getAgentReplPort(): number {
  const fromArgs = Deno.args
    .find((arg) => arg.startsWith("--agent-repl-port="))
    ?.split("=", 2)[1];
  const parsed = Number(fromArgs ?? Deno.env.get("PETPLAY_AGENT_REPL_PORT"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_REPL_PORT;
}

/** `http://127.0.0.1:<agentReplPort>` — the server's actor message surface. */
export function getAgentReplBaseUrl(): string {
  return `http://127.0.0.1:${getAgentReplPort()}`;
}

/**
 * JSON from the agent REPL surface (`/health`, `/message`, `/eval`, …). A
 * non-OK response throws with the server's own error text, so callers can tell
 * "the server refused" from "the server is not there" (which throws from
 * `fetch` itself).
 */
export async function fetchAgentReplJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getAgentReplBaseUrl()}${path}`, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return (text.length > 0 ? JSON.parse(text) : {}) as T;
}

type ActorAddress = string;

interface ActorNode {
  address: ActorAddress;
  assignMessage?: string; // Message the child should send to parent
  children?: Record<string, ActorNode>;
}

export async function assignActorHierarchy(
  tree: Record<string, ActorNode>,
  parent: ActorAddress | null = null
): Promise<void> {
  for (const node of Object.values(tree)) {
    if (parent && node.assignMessage) {
      await PostMan.PostMessage({
        target: node.address,
        type: node.assignMessage,
        payload: parent,
      });
    }

    if (node.children) {
      await assignActorHierarchy(node.children, node.address);
    }
  }
}

export function tempFile(filename: string, base: string): string {
  const basepath = join(base, "../")
  const file = Deno.readFileSync(join(basepath, filename))
  const temppath = Deno.makeTempFileSync({ dir: "./tmp", suffix: extname(filename) })
  Deno.writeFileSync(temppath, file)
  const path = Deno.realPathSync(temppath)
  return path
}

export async function createTemp(base: string) {
  await Deno.mkdir("./tmp", { recursive: true })

  //stupid hack
  const path = join(import.meta.dirname!, "../resources")
  const file = Deno.readFileSync(join(path, "bindings_oculus_touch.json"))
  const tmppath = join("./tmp", "bindings_oculus_touch.json")
  Deno.writeFileSync(tmppath, file)
}

export function ensuredenodir() {
  const denoDir = join(Deno.env.get("LOCALAPPDATA") || "", "deno");
  Deno.mkdirSync(denoDir, { recursive: true });
}

export function destroyTemp() {
  console.log("CLEAN")
  try {
    Deno.removeSync("./tmp/", { recursive: true });
  } catch (error) {
    // A shutdown that races or never created `./tmp` has nothing to remove;
    // only a real failure should surface as a teardown error.
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

const stream = Deno.stdin.readable.values();
export async function asyncPrompt(): Promise<string> {
  const next = await stream.next();
  if ("done" in next && next.done) {
    return "";
  } else {
    return new TextDecoder().decode(next.value).slice(0, -1);
  }
}