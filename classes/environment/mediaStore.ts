/**
 * Now playing, for the wrist media tile.
 *
 * Linux only, through MPRIS: the webxr actor runs `playerctl --follow` ({@link startMediaFollow})
 * and publishes each line here; the wrist reads it with {@link useNowPlaying}. Without playerctl,
 * or with no player running, there is nothing to show and the wrist keeps its usual tiles.
 */
import { useSyncExternalStore } from "react";

export type NowPlaying = {
  player: string;
  playing: boolean;
  artist: string;
  title: string;
};

export type MediaCommand = "play-pause" | "next" | "previous";

const FIELD_SEPARATOR = "\t";
export const PLAYERCTL_FORMAT = ["{{playerName}}", "{{status}}", "{{artist}}", "{{title}}"]
  .join(FIELD_SEPARATOR);

/** One `playerctl --follow` line; a blank line means the player went away. */
export function parsePlayerctlLine(line: string): NowPlaying | null {
  if (line.trim() === "") return null;
  const [player = "", status = "", artist = "", ...title] = line.split(FIELD_SEPARATOR);
  if (player === "") return null;
  return {
    player,
    playing: status === "Playing",
    artist,
    title: title.join(FIELD_SEPARATOR),
  };
}

/** "Artist · Title", or whichever of the two the player gave. */
export function nowPlayingLabel(nowPlaying: NowPlaying): string {
  return [nowPlaying.artist, nowPlaying.title].filter((part) => part !== "").join(" · ") ||
    nowPlaying.player;
}

function createMediaStore() {
  let current: NowPlaying | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    publish(next: NowPlaying | null) {
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const mediaStore = createMediaStore();

export function useNowPlaying(): NowPlaying | null {
  return useSyncExternalStore(mediaStore.subscribe, mediaStore.get, mediaStore.get);
}

/** Sends a transport command to the player on the tile, not whichever one playerctl picks. */
export function sendMediaCommand(command: MediaCommand): void {
  const player = mediaStore.get()?.player;
  if (player == null) return;
  // Optimistic, so the glyph flips on the click; the follow line confirms it a moment later.
  if (command === "play-pause") {
    const current = mediaStore.get();
    if (current != null) mediaStore.publish({ ...current, playing: !current.playing });
  }
  try {
    new Deno.Command("playerctl", {
      args: ["--player", player, command],
      stdout: "null",
      stderr: "null",
    }).spawn().status.catch(() => {});
  } catch {
    // No playerctl: the tile would not be showing.
  }
}

/**
 * Follows the active MPRIS player until `signal` aborts. Restarts playerctl if it exits (it does
 * when the session bus restarts), and gives up quietly where it isn't installed.
 */
export async function startMediaFollow(
  signal: AbortSignal,
  publish: (next: NowPlaying | null) => void = mediaStore.publish,
): Promise<void> {
  if (Deno.build.os !== "linux") return;
  while (!signal.aborted) {
    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command("playerctl", {
        args: ["--follow", "metadata", "--format", PLAYERCTL_FORMAT],
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
        for (const line of lines) publish(parsePlayerctlLine(line));
      }
    } catch {
      // Aborted, or the pipe broke; either way the loop decides what's next.
    }
    await child.status.catch(() => {});
    publish(null);
    if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
