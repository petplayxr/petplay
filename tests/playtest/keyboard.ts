/**
 * Keyboard playtest: one-shot Shift, Caps Lock, the special keys, and the keyboard riding along
 * when the window it hangs from moves. Legends are pinned to the US locale so the script finds
 * the same caps on any host layout, then switched to Finnish to check its letters are drawn.
 *
 * Run with `deno task playtest keyboard`.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import { onKeyboardEvent } from "../../classes/environment/keyboard/keyEvents.ts";
import type { KeyboardLogicEvent } from "../../classes/environment/keyboard/types.ts";
import { getSetting, setSetting } from "../../classes/settings.ts";
import { legendGlyph } from "../../classes/environment/keyboard/keyboardKeyInteraction.tsx";
import {
  editSpatialGraph,
  getSpatialGraph,
} from "../../classes/environment/workspaceLayoutStore.ts";
import {
  aim,
  laserDrag,
  LEFT_ORIGIN,
  openSettings,
  press as pressPill,
  showWindows,
  squeeze,
  toolbarButton,
  worldOf,
} from "./lib/steps.ts";

function keyboard(ctx: PlaytestContext): THREE.Object3D {
  const object = ctx.nodeObject("keyboard");
  if (object == null) throw new Error("the keyboard is not in the scene");
  return object;
}

/** Presses the caps labelled `legends` in order and returns the events they produced. */
async function press(ctx: PlaytestContext, ...legends: string[]): Promise<KeyboardLogicEvent[]> {
  const events: KeyboardLogicEvent[] = [];
  const stop = onKeyboardEvent((event) => events.push(event));
  try {
    for (const legend of legends) {
      const cap = ctx.textObject(keyboard(ctx), legendGlyph(legend).text);
      if (!ctx.expect(cap, `the keyboard has a ${legend} key`)) break;
      await ctx.clickObject(cap!, keyboard(ctx));
    }
    await ctx.frames(3);
  } finally {
    stop();
  }
  return events;
}

/** A legend with no glyphs in its font measures as nothing and gets blown up to fill the cap. */
function legendsFit(ctx: PlaytestContext) {
  const sizes: [string, number][] = [];
  keyboard(ctx).traverse((object) => {
    const text = object.userData?.raythreeUiText?.text;
    if (typeof text === "string") sizes.push([text, worldOf(object).scale.x]);
  });
  const usual = sizes.map(([, size]) => size).sort((a, b) => a - b)[sizes.length >> 1];
  const huge = sizes.filter(([, size]) => size > usual * 4).map(([text]) => text);
  ctx.note(`${sizes.length} legends`);
  ctx.expect(huge.length === 0, `every legend is drawn at keycap size (oversized: ${huge})`);
}

function keyboardNode() {
  const node = getSpatialGraph()?.nodes.keyboard;
  if (node?.kind !== "keyboard") throw new Error("the layout has no keyboard");
  return node;
}

function hingeAngle(): number | null {
  const constraint = keyboardNode().constraint;
  return constraint?.kind === "hinge" ? constraint.angle : null;
}

/** Laser-grabs the keyboard at its centre and pulls it 0.15 m down; returns how far it swung. */
async function keyboardDrag(ctx: PlaytestContext) {
  const angle = hingeAngle() ?? 0;
  const position = worldOf(keyboard(ctx)).position;
  const start = worldOf(keyboard(ctx)).position;
  aim(ctx, "left", LEFT_ORIGIN, start);
  await ctx.settle();
  squeeze(ctx, "left", true);
  await ctx.frames(3);
  for (let i = 1; i <= 10; i++) {
    const down = new THREE.Vector3(0, -0.015 * i, 0);
    aim(ctx, "left", LEFT_ORIGIN.clone().add(down), start.clone().add(down));
    await ctx.frames(1);
  }
  await ctx.frames(3);
  squeeze(ctx, "left", false);
  await ctx.settle();
  ctx.t.parkLeftHand();
  const swung = Math.abs((hingeAngle() ?? 0) - angle);
  const moved = worldOf(keyboard(ctx)).position.distanceTo(position);
  ctx.note(`drag: hinge ${swung.toFixed(4)} rad, ${moved.toFixed(4)} m`);
  return { swung, moved };
}

/** Two quick trigger pulls on the cap labelled `legend`, as a double tap; returns the events. */
async function doubleTap(ctx: PlaytestContext, legend: string): Promise<KeyboardLogicEvent[]> {
  const events: KeyboardLogicEvent[] = [];
  const cap = ctx.textObject(keyboard(ctx), legendGlyph(legend).text);
  if (!ctx.expect(cap, `the keyboard has a ${legend} key`)) return events;
  const stop = onKeyboardEvent((event) => events.push(event));
  try {
    const point = worldOf(cap!).position;
    const from = new THREE.Vector3(0, 0, 0.6).applyQuaternion(worldOf(keyboard(ctx)).quaternion)
      .add(point);
    aim(ctx, "left", from, point);
    await ctx.settle();
    for (let i = 0; i < 2; i++) {
      ctx.t.input.left.trigger = true;
      await ctx.frames(2);
      ctx.t.input.left.trigger = false;
      await ctx.frames(2);
    }
    await ctx.settle();
    ctx.t.parkLeftHand();
    await ctx.frames(3);
  } finally {
    stop();
  }
  return events;
}

/** Sets the keyboard's hinge angle directly, as a drag would. */
function setHingeAngle(angle: number) {
  editSpatialGraph((graph) => {
    const node = graph.nodes.keyboard;
    if (node?.kind !== "keyboard" || node.constraint?.kind !== "hinge") return graph;
    const constraint = { ...node.constraint, angle };
    return { ...graph, nodes: { ...graph.nodes, keyboard: { ...node, constraint } } };
  });
}

const chars = (events: KeyboardLogicEvent[]) =>
  events.flatMap((event) => event.kind === "key" ? [event.char ?? `<${event.scanCodeHex}>`] : []);

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "us-legends",
    run: async (ctx) => {
      setSetting("keyboardLocale", "us");
      await ctx.waitFor(() => ctx.textObject(keyboard(ctx), "Caps"), "the US legends are up");
    },
  },
  {
    name: "shift-is-one-shot",
    run: async (ctx) => {
      // A latched Shift relabels the caps, so the first press finds "A".
      const typed = chars(await press(ctx, "Shift", "A", "a"));
      ctx.note(`typed: ${typed.join(" ")}`);
      ctx.expect(typed[0] === "A", `Shift capitalises the next key (got ${typed[0]})`);
      ctx.expect(typed[1] === "a", `and releases after it (got ${typed[1]})`);
    },
  },
  {
    name: "caps-lock",
    run: async (ctx) => {
      const on = await press(ctx, "Caps");
      ctx.expect(
        on.some((event) => event.kind === "modifier" && event.modifier === "caps" && event.active),
        "Caps latches Caps Lock",
      );
      await ctx.waitFor(() => ctx.textObject(keyboard(ctx), "B"), "the letter legends turn upper");
      const typed = chars(await press(ctx, "B", "C"));
      ctx.note(`typed: ${typed.join(" ")}`);
      ctx.expect(typed.join("") === "BC", `Caps Lock stays on across keys (got ${typed.join("")})`);
      await press(ctx, "Caps");
      await ctx.waitFor(() => ctx.textObject(keyboard(ctx), "b"), "and Caps again turns it off");
    },
  },
  {
    name: "special-keys",
    run: async (ctx) => {
      const events = await press(ctx, "⌫", "↵", "Space");
      const codes = events.flatMap((event) => event.kind === "key" ? [event.scanCodeHex] : []);
      ctx.note(`scan codes: ${codes.join(" ")}`);
      ctx.expect(codes.join(" ") === "0E 1C 39", "Backspace, Enter and Space send their keys");
    },
  },
  {
    name: "shortcuts",
    run: async (ctx) => {
      // What the desktop sink sees: modifier down, key, modifier up, in that order.
      const stream = (events: KeyboardLogicEvent[]) =>
        events.map((event) =>
          event.kind === "key" ? event.scanCodeHex : `${event.modifier}${event.active ? "+" : "-"}`
        ).join(" ");
      const copy = stream(await press(ctx, "ctrl", "c"));
      ctx.note(`Ctrl c: ${copy}`);
      ctx.expect(
        /^(left|right)Ctrl\+ 2E (left|right)Ctrl-$/.test(copy),
        "Ctrl then c holds Ctrl over the c and releases it after",
      );
      const reopen = stream(await press(ctx, "ctrl", "Shift", "T"));
      ctx.note(`Ctrl Shift t: ${reopen}`);
      ctx.expect(
        /^(left|right)Ctrl\+ shift\+ 14 shift- (left|right)Ctrl-$/.test(reopen),
        "Ctrl and Shift both latch for a three-key chord and both release after it",
      );
      const alt = await press(ctx, "alt");
      ctx.expect(alt.some((event) => event.kind === "modifier" && event.active), "Alt latches");
      const tab = stream(await press(ctx, "Tab"));
      ctx.note(`then Tab: ${tab}`);
      ctx.expect(/^0F (left|right)Alt-$/.test(tab), "and applies to the next key, Tab");
    },
  },
  {
    name: "double-tap-holds",
    run: async (ctx) => {
      // XSO's hold lock: a quick second tap on Alt keeps it down, so Tab can cycle windows.
      const tapped = await doubleTap(ctx, "alt");
      ctx.expect(
        tapped.length === 1 && tapped[0].kind === "modifier" && tapped[0].active,
        `a double tap on Alt latches it once and does not unlatch (${tapped.length} events)`,
      );
      const tabs = await press(ctx, "Tab", "Tab");
      const codes = tabs.map((event) => event.kind === "key" ? event.scanCodeHex : "mod");
      ctx.note(`Tab Tab with Alt held: ${codes.join(" ")}`);
      ctx.expect(codes.join(" ") === "0F 0F", "Alt stays down across both Tabs");
      const release = await press(ctx, "alt");
      ctx.expect(
        release.some((event) => event.kind === "modifier" && !event.active),
        "one more tap lets Alt go",
      );
      const plain = await press(ctx, "Tab");
      ctx.expect(
        plain.length === 1 && plain[0].kind === "key",
        "and the next key goes out without it",
      );
      // A slow second tap is just a second tap: it unlatches.
      await press(ctx, "alt");
      // The double-tap window is real time, so wait it out on the clock rather than in frames.
      await ctx.sleep(300);
      const slow = await press(ctx, "alt");
      ctx.expect(
        slow.some((event) => event.kind === "modifier" && !event.active),
        "a slow second tap unlatches instead of holding",
      );
    },
  },
  {
    name: "legends-fit",
    run: (ctx) => {
      legendsFit(ctx);
      return Promise.resolve();
    },
  },
  {
    name: "rides-with-window",
    run: async (ctx) => {
      const before = worldOf(keyboard(ctx)).position;
      const moved = await laserDrag(ctx, 0.25);
      const followed = worldOf(keyboard(ctx)).position.distanceTo(before);
      ctx.note(`window moved ${moved.toFixed(3)} m, keyboard ${followed.toFixed(3)} m`);
      ctx.expect(
        Math.abs(followed - moved) < 0.02,
        "the hinged keyboard moves with its window",
      );
    },
  },
  {
    name: "finnish-legends",
    run: async (ctx) => {
      setSetting("keyboardLocale", "fi");
      try {
        if (
          !await ctx.waitFor(() => ctx.textObject(keyboard(ctx), "ö"), "the Finnish legends are up")
        ) return;
        await ctx.settle();
        legendsFit(ctx);
        for (const legend of ["ö", "ä", "å", "§", "´", "¨"]) {
          ctx.expect(
            legendGlyph(legend).font === "material-icons",
            `${legend} comes from the atlas that has it`,
          );
        }
        const typed = chars(await press(ctx, "ö", "ä"));
        ctx.note(`typed: ${typed.join(" ")}`);
        ctx.expect(typed.join("") === "öä", `the Finnish letters type (got ${typed.join("")})`);
      } finally {
        setSetting("keyboardLocale", "us");
      }
    },
  },
  {
    name: "toolbar-reset",
    run: async (ctx) => {
      const resting = hingeAngle();
      if (!ctx.expect(resting != null, "the keyboard is hinged to the window")) return;
      setHingeAngle(resting! + 0.5);
      await ctx.settle();
      if (!await toolbarButton(ctx, "refresh", keyboard(ctx))) return;
      await ctx.waitFor(
        () => Math.abs((hingeAngle() ?? 0) - resting!) < 1e-6,
        `Reset pose folds the keyboard back to its resting angle (${
          THREE.MathUtils.radToDeg(resting!).toFixed(0)
        }°)`,
      );
      ctx.note(`hinge after reset: ${THREE.MathUtils.radToDeg(hingeAngle() ?? NaN).toFixed(1)}°`);
    },
  },
  {
    name: "toolbar-lock",
    run: async (ctx) => {
      const resting = hingeAngle();
      const free = await keyboardDrag(ctx);
      ctx.expect(free.swung > 0.05 || free.moved > 0.02, "an unlocked keyboard moves when grabbed");
      if (resting != null) setHingeAngle(resting);
      await ctx.settle();
      if (!await toolbarButton(ctx, "lock", keyboard(ctx))) return;
      if (!await ctx.waitFor(() => keyboardNode().locked === true, "the lock button locks it")) {
        return;
      }
      try {
        const { swung, moved } = await keyboardDrag(ctx);
        ctx.expect(swung < 1e-3 && moved < 0.005, "a locked keyboard does not move when grabbed");
      } finally {
        await toolbarButton(ctx, "lock", keyboard(ctx));
        await ctx.waitFor(() => !keyboardNode().locked, "and pressing it again unlocks it");
      }
    },
  },
  {
    name: "toolbar-settings",
    run: async (ctx) => {
      const root = keyboard(ctx);
      if (!await openSettings(ctx, root)) return;
      try {
        if (!await pressPill(ctx, "Typing sounds", "Off", root)) return;
        await ctx.waitFor(() => getSetting("typingSounds") === false, "Typing sounds Off");
        if (!await pressPill(ctx, "Typing sounds", "On", root)) return;
        await ctx.waitFor(() => getSetting("typingSounds") === true, "and back On");
        if (!await pressPill(ctx, "Key legends", "Suomi", root)) return;
        await ctx.waitFor(
          () => getSetting("keyboardLocale") === "fi" && ctx.textObject(keyboard(ctx), "ö"),
          "Key legends Suomi puts the Finnish legends up",
        );
        if (!await pressPill(ctx, "Key legends", "English (US)", keyboard(ctx))) return;
        await ctx.waitFor(
          () => getSetting("keyboardLocale") === "us" && ctx.textObject(keyboard(ctx), "Caps"),
          "and English (US) puts the US ones back",
        );
      } finally {
        setSetting("typingSounds", true);
        setSetting("keyboardLocale", "us");
      }
    },
  },
  {
    // Last: a detached keyboard stays detached for the rest of the run.
    name: "toolbar-detach",
    run: async (ctx) => {
      const before = worldOf(keyboard(ctx)).position;
      if (!await toolbarButton(ctx, "link", keyboard(ctx))) return;
      if (
        !await ctx.waitFor(() => keyboardNode().parentId == null, "the link button detaches it")
      ) return;
      await ctx.settle();
      const jump = worldOf(keyboard(ctx)).position.distanceTo(before);
      ctx.note(`detaching moved it ${jump.toFixed(4)} m`);
      ctx.expect(jump < 0.01, "detaching leaves the keyboard where it was");
      const at = worldOf(keyboard(ctx)).position;
      const moved = await laserDrag(ctx, 0.25);
      const drift = worldOf(keyboard(ctx)).position.distanceTo(at);
      ctx.note(`window moved ${moved.toFixed(3)} m, keyboard ${drift.toFixed(4)} m`);
      ctx.expect(
        moved > 0.1 && drift < 0.01,
        "a detached keyboard no longer rides with the window",
      );
    },
  },
];
