/**
 * Toasts playtest: desktop notifications and XSO senders show as head-locked cards below the line
 * of sight, updates replace rather than stack, a burst queues past three, long text wraps inside
 * the card, the stack follows the head, and a laser passes through it to the window behind.
 *
 * Desktop notifications go straight into the sink with a `busctl monitor` line, so nothing is
 * sent on the real session bus. The XSO step sends to localhost only when this server holds the
 * XSO ports (it skips if another PetPlay already had them).
 *
 * Run with `deno task playtest toasts`.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import { dirname, join } from "@std/path";
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import { MAX_VISIBLE_TOASTS, toastQueue } from "../../classes/environment/toastStore.ts";
import {
  createNotificationSink,
  parseNotifyLine,
} from "../../classes/environment/desktopNotifications.ts";
import { XSO_UDP_PORT } from "../../classes/environment/xsoNotificationReceiver.ts";
import {
  display,
  laserDrag,
  rootDisplayId,
  showWindows,
  toolbarOf,
  turnHead,
  worldOf,
} from "./lib/steps.ts";

/** One `Notify` call as `busctl monitor --json=short` prints it. */
function notifyLine(app: string, summary: string, body: string, replacesId = 0): string {
  return JSON.stringify({
    member: "Notify",
    payload: {
      data: [app, replacesId, "", summary, body, [], { urgency: { type: "y", data: 1 } }, 6000],
    },
  });
}

/** The sink is kept across steps, so its replace bookkeeping carries over like the real one. */
function sink(ctx: PlaytestContext) {
  return (ctx.memo.sink ??= createNotificationSink(undefined, undefined, () => true)) as ReturnType<
    typeof createNotificationSink
  >;
}

function notify(ctx: PlaytestContext, app: string, summary: string, body: string, replaces = 0) {
  const notification = parseNotifyLine(notifyLine(app, summary, body, replaces));
  if (!ctx.expect(notification, `"${summary}" parses as a notification`)) return;
  sink(ctx)(notification!);
}

/** Dismissing a visible toast promotes a waiting one, so keep going until both are empty. */
function clearToasts() {
  while (toastQueue.visible().length > 0) {
    for (const toast of toastQueue.visible()) toastQueue.dismiss(toast.id);
  }
}

function overlay(ctx: PlaytestContext): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  ctx.scene().traverse((object) => {
    if (found == null && object.userData?.toastOverlay) found = object;
  });
  return found;
}

function overlayText(ctx: PlaytestContext, text: string): THREE.Object3D | null {
  const root = overlay(ctx);
  return root == null ? null : ctx.textObject(root, text);
}

/** World bounds of an object's meshes. */
function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

/** Toasts sit a little below the line of sight; returns the stack's direction from the head. */
function stackDirection(ctx: PlaytestContext): THREE.Vector3 | null {
  const root = overlay(ctx);
  if (root == null) return null;
  const eye = new THREE.Vector3(0, 1.6, 0);
  return worldOf(root).position.sub(eye).normalize();
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "desktop-notification",
    run: async (ctx) => {
      clearToasts();
      notify(ctx, "Firefox", "Download finished", "petplay-2.0.tar.gz");
      await ctx.waitFor(
        () => overlayText(ctx, "Download finished"),
        "a desktop notification shows as a toast with its summary",
      );
      ctx.expect(overlayText(ctx, "petplay-2.0.tar.gz"), "the toast shows the body");
      ctx.expect(overlayText(ctx, "Firefox"), "the toast shows the sending app");
      const direction = stackDirection(ctx);
      if (ctx.expect(direction, "the toast stack is in the scene")) {
        ctx.note(`stack direction ${direction!.toArray().map((v) => v.toFixed(2)).join(", ")}`);
        ctx.expect(direction!.z < -0.8, "the toast is in front of the head");
        ctx.expect(
          direction!.y < -0.1 && direction!.y > -0.6,
          "the toast sits below the line of sight",
        );
      }
    },
  },
  {
    name: "update-replaces",
    run: async (ctx) => {
      notify(ctx, "Steam", "Updating", "10%");
      await ctx.waitFor(() => overlayText(ctx, "10%"), "the first progress toast shows");
      notify(ctx, "Steam", "Updating", "60%", 7);
      await ctx.waitFor(() => overlayText(ctx, "60%"), "the progress update shows");
      await ctx.waitFor(
        () => overlayText(ctx, "10%") == null,
        "the update replaces the old toast instead of stacking under it",
      );
    },
  },
  {
    name: "burst-queues",
    run: async (ctx) => {
      clearToasts();
      await ctx.settle();
      for (let i = 1; i <= 5; i++) notify(ctx, "Chat", `Message ${i}`, "");
      await ctx.waitFor(() => overlayText(ctx, "Message 3"), "the first three of a burst show");
      ctx.expect(
        toastQueue.visible().length === MAX_VISIBLE_TOASTS && toastQueue.pending() === 2,
        `three show and two wait (${toastQueue.visible().length} shown, ${toastQueue.pending()} waiting)`,
      );
      // Cards stack in a column without overlapping.
      const cards = [1, 2, 3].map((i) => overlayText(ctx, `Message ${i}`));
      if (ctx.expect(cards.every((card) => card != null), "all three cards are drawn")) {
        const ys = cards.map((card) => worldOf(card!).position.y);
        ctx.note(`card title heights ${ys.map((y) => y.toFixed(3)).join(", ")}`);
        ctx.expect(ys[0] > ys[1] && ys[1] > ys[2], "the cards stack top to bottom in order");
        ctx.expect(
          ys[0] - ys[1] > 0.02 && ys[1] - ys[2] > 0.02,
          "the cards are spaced apart, not drawn over each other",
        );
      }
      toastQueue.dismiss(toastQueue.visible()[0].id);
      await ctx.waitFor(
        () => overlayText(ctx, "Message 4"),
        "dismissing one lets the next waiting toast in",
      );
    },
  },
  {
    name: "long-text-wraps",
    run: async (ctx) => {
      clearToasts();
      await ctx.settle();
      const body = "The quick brown fox jumps over the lazy dog. ".repeat(6).trim();
      notify(ctx, "Mail", "A long message", body);
      await ctx.waitFor(() => overlayText(ctx, "A long message"), "the long toast shows");
      // The body is wrapped into lines, so its text node holds newlines once measuring is done.
      const wrapped = () => {
        let found: THREE.Object3D | null = null;
        overlay(ctx)?.traverse((object) => {
          const text = object.userData?.raythreeUiText?.text;
          if (typeof text === "string" && text.startsWith("The quick") && text.includes("\n")) {
            found = object;
          }
        });
        return found as THREE.Object3D | null;
      };
      await ctx.waitFor(wrapped, "the long body is broken onto several lines");
      const title = overlayText(ctx, "A long message");
      const text = wrapped();
      if (title != null && text != null) {
        const titleBox = bounds(title);
        const textBox = bounds(text);
        const width = textBox.max.x - textBox.min.x;
        ctx.note(
          `body ${width.toFixed(3)} m wide, ${
            text.userData.raythreeUiText.text.split("\n").length
          } lines`,
        );
        ctx.expect(width > 0 && width < 0.4, "the wrapped body stays inside the card's width");
        ctx.expect(textBox.max.y <= titleBox.min.y + 0.005, "the body sits under the title");
      }
    },
  },
  {
    name: "follows-head",
    run: async (ctx) => {
      clearToasts();
      await ctx.settle();
      notify(ctx, "Calendar", "Standup in 5 minutes", "");
      await ctx.waitFor(() => overlayText(ctx, "Standup in 5 minutes"), "the toast shows");
      turnHead(ctx, Math.PI / 2);
      // A +90° yaw turns the view from -z to -x.
      await ctx.waitFor(
        () => (stackDirection(ctx)?.x ?? 0) < -0.8,
        "the toast follows the head to its new direction",
      );
      turnHead(ctx, 0);
      await ctx.waitFor(
        () => (stackDirection(ctx)?.z ?? 0) < -0.8,
        "the toast comes back in front when the head turns back",
      );
    },
  },
  {
    name: "laser-passes-through",
    run: async (ctx) => {
      clearToasts();
      await ctx.settle();
      notify(ctx, "Chat", "Over the window", "");
      await ctx.waitFor(() => overlayText(ctx, "Over the window"), "the toast shows");
      const id = rootDisplayId();
      const before = worldOf(display(ctx)).position;
      // Aim through the toast at the window behind it, and grab: the window must move.
      const moved = await laserDrag(ctx, 0.1);
      ctx.note(`window moved ${moved.toFixed(3)} m with a toast up (${id})`);
      ctx.expect(moved > 0.05, "a laser grab through the toast still reaches the window");
      ctx.expect(toolbarOf(display(ctx)) != null, "the window behind the toast is selected");
      ctx.memo.windowBefore = before.toArray();
    },
  },
  {
    name: "xso-udp",
    run: async (ctx) => {
      // Only send when this server owns the port: otherwise it would reach another PetPlay.
      const settingsPath = Deno.env.get("PETPLAY_SETTINGS_PATH");
      const log = settingsPath == null
        ? ""
        : await Deno.readTextFile(join(dirname(settingsPath), "server.log")).catch(() => "");
      if (settingsPath == null || log.includes(`UDP ${XSO_UDP_PORT} unavailable`)) {
        ctx.note("skipped: another process holds the XSO port");
        return;
      }
      clearToasts();
      await ctx.settle();
      const socket = Deno.listenDatagram({ transport: "udp", hostname: "127.0.0.1", port: 0 });
      const datagram = JSON.stringify({
        messageType: 1,
        title: "Heart rate",
        content: "92 bpm",
        timeout: 5,
        sourceApp: "HRM",
        icon: "warning",
      });
      await socket.send(new TextEncoder().encode(datagram), {
        transport: "udp",
        hostname: "127.0.0.1",
        port: XSO_UDP_PORT,
      });
      socket.close();
      await ctx.waitFor(() => overlayText(ctx, "Heart rate"), "an XSO datagram shows as a toast");
      ctx.expect(overlayText(ctx, "HRM"), "the XSO toast shows its sourceApp");
      ctx.expect(
        toastQueue.visible().some((toast) =>
          toast.title === "Heart rate" && toast.tone === "warning"
        ),
        'the XSO "warning" icon gives a warning toast',
      );
    },
  },
];
