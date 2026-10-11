import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  clampToastMs,
  createToastQueue,
  DEFAULT_TOAST_MS,
  MAX_TOAST_MS,
  MAX_VISIBLE_TOASTS,
  MIN_TOAST_MS,
} from "./toastStore.ts";

Deno.test("toast queue shows up to the limit and promotes in arrival order", () => {
  let t = 0;
  const q = createToastQueue(() => t);
  for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i++) q.push({ title: `t${i}`, timeoutMs: 2000 });
  assertEquals(q.visible().map((x) => x.title), ["t0", "t1", "t2"]);
  assertEquals(q.pending(), 2);

  t = 1999;
  q.tick();
  assertEquals(q.visible().length, 3);

  t = 2000;
  q.tick();
  assertEquals(q.visible().map((x) => x.title), ["t3", "t4"]);
  // Promoted toasts get their full time from when they appear.
  t = 3999;
  q.tick();
  assertEquals(q.visible().length, 2);
  t = 4000;
  q.tick();
  assertEquals(q.visible().length, 0);
});

Deno.test("dismiss removes a toast and promotes a waiting one", () => {
  const q = createToastQueue(() => 0);
  const ids = [0, 1, 2, 3].map((i) => q.push({ title: `t${i}` }).id);
  let emits = 0;
  q.subscribe(() => emits++);
  q.dismiss(ids[1]);
  assertEquals(q.visible().map((x) => x.title), ["t0", "t2", "t3"]);
  q.dismiss(999);
  assertEquals(emits, 1);
});

Deno.test("toast timeouts are clamped", () => {
  assertEquals(clampToastMs(undefined), DEFAULT_TOAST_MS);
  assertEquals(clampToastMs(Number.NaN), DEFAULT_TOAST_MS);
  assertEquals(clampToastMs(-5), DEFAULT_TOAST_MS);
  assertEquals(clampToastMs(10), MIN_TOAST_MS);
  assertEquals(clampToastMs(1e9), MAX_TOAST_MS);
});
