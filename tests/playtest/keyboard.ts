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
import { setSetting } from "../../classes/settings.ts";
import { legendGlyph } from "../../classes/environment/keyboard/keyboardKeyInteraction.tsx";
import { laserDrag, showWindows, worldOf } from "./lib/steps.ts";

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
    await ctx.sleep(200);
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
        await ctx.sleep(300);
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
];
