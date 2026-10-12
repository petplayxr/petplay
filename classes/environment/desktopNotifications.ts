/**
 * Desktop notifications, mirrored into the headset as toasts.
 *
 * Linux only. `busctl monitor` watches the session bus for `Notify` calls to the notification
 * server, so the desktop still shows its own popup and PetPlay only listens; nothing replaces the
 * user's notification daemon. `--json` hands over the arguments already parsed, which a
 * `dbus-monitor` text dump would not (multi-line bodies, quotes). Without busctl, or with the
 * `desktopNotifications` setting off, nothing is shown.
 */
import {
  DEFAULT_TOAST_MS,
  pushToast,
  type Toast,
  type ToastInput,
  toastQueue,
} from "./toastStore.ts";
import { getSetting } from "../settings.ts";

export const NOTIFY_MATCH =
  "type='method_call',interface='org.freedesktop.Notifications',member='Notify'";

/** One `Notify` call: who sent it, what it replaces, and the toast to show for it. */
export type DesktopNotification = {
  app: string;
  /** Non-zero when the sender updates a notification it already showed (progress, now playing). */
  replacesId: number;
  toast: ToastInput;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Bodies may carry the spec's small markup subset; the toast draws plain text. */
export function stripNotificationMarkup(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .trim();
}

type Variant = { type?: string; data?: unknown };

/** Parses one line of `busctl monitor --json=short`; anything but a `Notify` call is null. */
export function parseNotifyLine(line: string): DesktopNotification | null {
  let message: {
    member?: string;
    payload?: { data?: unknown[] };
  };
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (message.member !== "Notify") return null;
  const data = message.payload?.data;
  if (!Array.isArray(data) || data.length < 8) return null;
  const [app, replacesId, , summary, body, , hints, expire] = data as [
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    Record<string, Variant> | undefined,
    unknown,
  ];
  const title = typeof summary === "string" ? summary.trim() : "";
  const content = typeof body === "string" ? stripNotificationMarkup(body) : "";
  if (title === "" && content === "") return null;
  const appName = typeof app === "string" && app !== "" ? app : "Desktop";
  // Urgency is a byte: 0 low, 1 normal, 2 critical.
  const critical = hints?.urgency?.data === 2;
  // -1 is "server default" and 0 is "never expires"; both get the usual toast time.
  const timeoutMs = typeof expire === "number" && expire > 0 ? expire : DEFAULT_TOAST_MS;
  return {
    app: appName,
    replacesId: typeof replacesId === "number" ? replacesId : 0,
    toast: {
      // A notification with only a body uses it as the title, so the card never leads with a
      // blank line.
      title: title || content,
      content: title ? content : "",
      source: appName,
      timeoutMs,
      tone: critical ? "warning" : "info",
    },
  };
}

/**
 * Pushes notifications as toasts. An update to a notification already on screen replaces its
 * toast rather than stacking a new one behind it; the server's ids are not visible to a monitor,
 * so updates are matched by sender and title.
 */
export function createNotificationSink(
  push: (input: ToastInput) => Toast = pushToast,
  dismiss: (id: number) => void = toastQueue.dismiss,
  enabled: () => boolean = () => getSetting("desktopNotifications"),
): (notification: DesktopNotification) => void {
  const shown = new Map<string, number>();
  return (notification) => {
    if (!enabled()) return;
    const key = `${notification.app}\u0000${notification.toast.title}`;
    const previous = shown.get(key);
    if (notification.replacesId !== 0 && previous != null) dismiss(previous);
    shown.set(key, push(notification.toast).id);
    // Only the most recent few can still be on screen.
    if (shown.size > 32) shown.delete(shown.keys().next().value!);
  };
}

/** Mirrors notifications until `signal` aborts; restarts busctl if it exits. */
export async function startDesktopNotificationFollow(
  signal: AbortSignal,
  sink: (notification: DesktopNotification) => void = createNotificationSink(),
): Promise<void> {
  if (Deno.build.os !== "linux") return;
  while (!signal.aborted) {
    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command("busctl", {
        args: ["--user", "monitor", "--json=short", "--match", NOTIFY_MATCH],
        stdout: "piped",
        stderr: "null",
        signal,
      }).spawn();
    } catch {
      return;
    }
    let buffered = "";
    try {
      for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
        buffered += chunk;
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const notification = parseNotifyLine(line);
          if (notification != null) sink(notification);
        }
      }
    } catch {
      // Aborted, or the pipe broke; either way the loop decides what's next.
    }
    await child.status.catch(() => {});
    if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
