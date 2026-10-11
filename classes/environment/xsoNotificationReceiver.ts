/**
 * XSOverlay-compatible notification receiver, so VRChat tools that already send toasts to XSO
 * (OSC helpers, chat relays, heart-rate monitors) reach PetPlay unchanged.
 *
 * Two wire formats, both on localhost:
 *
 * - **Legacy UDP, port 42069:** one JSON object per datagram,
 *   `{ messageType: 1, title, content, timeout (seconds), sourceApp, icon, ... }`.
 *   `messageType` 2 (media info) and anything else is ignored.
 * - **WebSocket API, port 42070:** clients connect to `ws://localhost:42070/?client=<name>` and send
 *   `{ sender, target: "xsoverlay", command: "SendNotification", jsonData: "<notification JSON>" }`.
 *   Other commands get no reply; PetPlay is not XSO and does not pretend to answer them.
 *
 * `height`, `opacity`, `volume`, `audioPath` and base64 icons are accepted and ignored. The XSO
 * built-in icon names `"error"` and `"warning"` pick the toast tone.
 *
 * If XSOverlay (or another PetPlay) already holds a port, that half is skipped with a log line.
 */
import { pushToast, type ToastInput } from "./toastStore.ts";

export const XSO_UDP_PORT = 42069;
export const XSO_WS_PORT = 42070;

const MAX_TITLE = 120;
const MAX_CONTENT = 600;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** One XSO notification object (the legacy datagram, or a WebSocket message's `jsonData`). */
export function toastFromXsoNotification(raw: unknown): ToastInput | null {
  const n = asRecord(raw);
  if (n == null) return null;
  if (n.messageType !== undefined && n.messageType !== 1) return null;
  const title = text(n.title, MAX_TITLE);
  const content = text(n.content, MAX_CONTENT);
  if (title === "" && content === "") return null;
  const icon = n.useBase64Icon === true ? "" : text(n.icon, 32).toLowerCase();
  return {
    title: title || content,
    content: title ? content : "",
    source: text(n.sourceApp, 60) || "XSO",
    timeoutMs: typeof n.timeout === "number" ? n.timeout * 1000 : undefined,
    tone: icon === "error" ? "error" : icon === "warning" ? "warning" : "info",
  };
}

/** A WebSocket API message; `null` for anything that is not `SendNotification`. */
export function toastFromXsoApiMessage(raw: unknown): ToastInput | null {
  const m = asRecord(raw);
  if (m == null || m.command !== "SendNotification") return null;
  let data: unknown = m.jsonData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const toast = toastFromXsoNotification(data);
  if (toast != null && toast.source === "XSO" && typeof m.sender === "string" && m.sender) {
    toast.source = m.sender.slice(0, 60);
  }
  return toast;
}

function parseJson(bytes: Uint8Array | string): unknown {
  try {
    return JSON.parse(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export type XsoReceiver = { udp: boolean; ws: boolean; close: () => void };

export function startXsoNotificationReceiver(
  { udpPort = XSO_UDP_PORT, wsPort = XSO_WS_PORT, onToast = pushToast, log = console.warn }: {
    udpPort?: number;
    wsPort?: number;
    onToast?: (toast: ToastInput) => unknown;
    log?: (message: string) => void;
  } = {},
): XsoReceiver {
  const closers: (() => void)[] = [];
  let udp = false;
  let ws = false;

  try {
    const socket = Deno.listenDatagram({ transport: "udp", hostname: "127.0.0.1", port: udpPort });
    udp = true;
    closers.push(() => socket.close());
    (async () => {
      try {
        for await (const [bytes] of socket) {
          const toast = toastFromXsoNotification(parseJson(bytes));
          if (toast != null) onToast(toast);
        }
      } catch {
        // closed
      }
    })();
  } catch (error) {
    log(`[xso] UDP ${udpPort} unavailable, legacy notifications off: ${error}`);
  }

  try {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: wsPort, onListen: () => {} },
      (request) => {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return new Response("PetPlay XSO-compatible notification endpoint\n");
        }
        const { socket, response } = Deno.upgradeWebSocket(request);
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          const toast = toastFromXsoApiMessage(parseJson(event.data));
          if (toast != null) onToast(toast);
        };
        return response;
      },
    );
    ws = true;
    closers.push(() => void server.shutdown());
  } catch (error) {
    log(`[xso] WebSocket ${wsPort} unavailable, API notifications off: ${error}`);
  }

  return {
    udp,
    ws,
    close: () => {
      for (const close of closers) close();
    },
  };
}
