import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import {
  defaultSettings,
  getSetting,
  loadSettings,
  parseSettings,
  setSetting,
  subscribeSettings,
} from "./settings.ts";

Deno.test("parseSettings keeps valid known keys, defaults invalid ones, keeps unknown keys", () => {
  const { settings, extra } = parseSettings(
    JSON.stringify({ grabboxOutline: false, controllerLaser: "yes", futureThing: 3 }),
  );
  assertEquals(settings.grabboxOutline, false);
  assertEquals(settings.controllerLaser, defaultSettings().controllerLaser);
  assertEquals(extra, { futureThing: 3 });
});

Deno.test("parseSettings falls back to defaults on junk", () => {
  assertEquals(parseSettings("not json").settings, defaultSettings());
  assertEquals(parseSettings("[1,2]").settings, defaultSettings());
});

Deno.test("setSetting persists, round-trips and preserves unknown keys", () => {
  const dir = Deno.makeTempDirSync();
  const path = `${dir}/settings.json`;
  Deno.writeTextFileSync(path, JSON.stringify({ futureThing: 3 }));
  loadSettings(path);
  let notified = 0;
  const unsubscribe = subscribeSettings(() => notified++);
  setSetting("controllerLaser", false);
  setSetting("controllerLaser", false); // unchanged: no write, no event
  unsubscribe();
  assertEquals(notified, 1);
  const written = JSON.parse(Deno.readTextFileSync(path));
  assertEquals(written.controllerLaser, false);
  assertEquals(written.futureThing, 3);
  loadSettings(path);
  assertEquals(getSetting("controllerLaser"), false);
  Deno.removeSync(dir, { recursive: true });
});

Deno.test("setSetting rejects invalid values", () => {
  // deno-lint-ignore no-explicit-any
  assertThrows(() => setSetting("grabboxOutline", "on" as any));
});
