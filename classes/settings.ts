/**
 * User settings: one typed store, persisted to `$XDG_CONFIG_HOME/petplay/settings.json`
 * (`PETPLAY_SETTINGS_PATH` overrides).
 *
 * Module state is per isolate. The isolate that owns the scene (the `webxr` actor) loads the file
 * once and writes it back on every change; other readers can load it themselves. Unknown keys in
 * the file are kept, so a newer build's settings survive a run of an older one.
 */
import { dirname, join } from "@std/path";
import { useSyncExternalStore } from "react";

export const SETTINGS_FILENAME = "settings.json";

type SettingSpec<T> = {
  default: T;
  /** One line for a settings surface / `client settings`. */
  label: string;
  valid: (value: unknown) => value is T;
};

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isHand = (value: unknown): value is "left" | "right" => value === "left" || value === "right";
const isLocaleOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && /^[a-z]{2,3}$/.test(value));

export const SETTINGS_SCHEMA = {
  grabboxOutline: {
    default: true as boolean,
    label: "Draw grab-box outlines (the hull stays grabbable either way)",
    valid: isBoolean,
  } satisfies SettingSpec<boolean>,
  controllerLaser: {
    default: true as boolean,
    label: "Controller laser beams (pointing works either way)",
    valid: isBoolean,
  } satisfies SettingSpec<boolean>,
  haptics: {
    default: true as boolean,
    label: "Controller vibration on button hover and click",
    valid: isBoolean,
  } satisfies SettingSpec<boolean>,
  wristMenuHand: {
    default: "right" as "left" | "right",
    label: "Controller that wears the wrist menu; the other hand points at it",
    valid: isHand,
  } satisfies SettingSpec<"left" | "right">,
  keyboardLocale: {
    default: null as string | null,
    label: "Keyboard legend locale; null follows --keyboard-locale / the host layout",
    valid: isLocaleOrNull,
  } satisfies SettingSpec<string | null>,
};

export type Settings = {
  [K in keyof typeof SETTINGS_SCHEMA]: (typeof SETTINGS_SCHEMA)[K]["default"];
};
export type SettingKey = keyof Settings;

export function defaultSettings(): Settings {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) out[key] = spec.default;
  return out as Settings;
}

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key);
}

export function isValidSetting<K extends SettingKey>(key: K, value: unknown): value is Settings[K] {
  return (SETTINGS_SCHEMA[key].valid as (value: unknown) => boolean)(value);
}

/** Known keys with valid values win; invalid ones fall back to the default; unknown keys are kept. */
export function parseSettings(
  text: string,
): { settings: Settings; extra: Record<string, unknown> } {
  const settings = defaultSettings();
  const extra: Record<string, unknown> = {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { settings, extra };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { settings, extra };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSettingKey(key)) extra[key] = value;
    else if (isValidSetting(key, value)) (settings as Record<string, unknown>)[key] = value;
  }
  return { settings, extra };
}

export function getSettingsPath(): string {
  const override = Deno.env.get("PETPLAY_SETTINGS_PATH");
  if (override) return override;
  const configHome = Deno.env.get("XDG_CONFIG_HOME") ??
    join(Deno.env.get("HOME") ?? Deno.cwd(), ".config");
  return join(configHome, "petplay", SETTINGS_FILENAME);
}

let current: Settings = defaultSettings();
let extraKeys: Record<string, unknown> = {};
/** Where changes are written; null until `loadSettings` runs, so tests and readers stay in memory. */
let persistPath: string | null = null;
const listeners = new Set<() => void>();

/** Load the file (missing → defaults) and persist later changes to it. */
export function loadSettings(path = getSettingsPath()): Settings {
  try {
    const parsed = parseSettings(Deno.readTextFileSync(path));
    current = parsed.settings;
    extraKeys = parsed.extra;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(`[settings] could not load ${path}`, error);
    }
    current = defaultSettings();
    extraKeys = {};
  }
  persistPath = path;
  emit();
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  return current[key];
}

/** Throws on an invalid value, so a bad REPL/actor call fails loudly instead of persisting junk. */
export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  if (!isValidSetting(key, value)) {
    throw new Error(`invalid value for setting "${key}": ${JSON.stringify(value)}`);
  }
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  save();
  emit();
}

export function resetSettings(): void {
  current = defaultSettings();
  save();
  emit();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSetting<K extends SettingKey>(key: K): Settings[K] {
  const read = () => current[key];
  return useSyncExternalStore(subscribeSettings, read, read);
}

function emit(): void {
  for (const listener of listeners) listener();
}

function save(): void {
  if (persistPath == null) return;
  const path = persistPath;
  const temporaryPath = `${path}.${Deno.pid}.tmp`;
  try {
    Deno.mkdirSync(dirname(path), { recursive: true });
    Deno.writeTextFileSync(
      temporaryPath,
      `${JSON.stringify({ ...extraKeys, ...current }, null, 2)}\n`,
    );
    Deno.renameSync(temporaryPath, path);
  } catch (error) {
    try {
      Deno.removeSync(temporaryPath);
    } catch {
      // Nothing temporary was left behind.
    }
    console.warn(`[settings] could not save ${path}`, error);
  }
}
