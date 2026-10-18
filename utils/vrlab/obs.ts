/**
 * OBS through obs-websocket v5, using the password from OBS's own config. Enable the server once
 * with {@link enableObsWebsocket} (OBS reads it at startup).
 *
 * On Linux, launch OBS with `QT_QPA_PLATFORM=xcb` ({@link launchObs}) so the Xcomposite window
 * source exists: it captures X11 windows (VRChat under Proton, PetPlay's GLFW windows) with alpha
 * and without the portal's window picker. Create that source with its window already set:
 * OBS 32 crashes on an `xcomposite_input` whose `capture_window` is empty.
 */
import { desktopEnv, pidsNamed, waitFor } from "./util.ts";
import { obsXcompositeWindow, type X11Window } from "./x11.ts";

const CONFIG_DIR = `${Deno.env.get("HOME")}/.config/obs-studio`;
const WEBSOCKET_CONFIG = `${CONFIG_DIR}/plugin_config/obs-websocket/config.json`;

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export class Obs {
  private next = 0;
  private readonly pending = new Map<
    string,
    (
      value: {
        requestStatus: { result: boolean; code: number; comment?: string };
        responseData?: any;
      },
    ) => void
  >();
  private constructor(private readonly ws: WebSocket) {}

  static async connect(): Promise<Obs> {
    const config = JSON.parse(await Deno.readTextFile(WEBSOCKET_CONFIG));
    const ws = new WebSocket(`ws://127.0.0.1:${config.server_port}`);
    let obs!: Obs;
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () =>
        reject(new Error("OBS websocket unreachable: is OBS running with the server enabled?"));
      ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.op === 0) {
          const auth = message.d.authentication;
          const d: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 };
          if (auth) {
            d.authentication = await sha256Base64(
              (await sha256Base64(config.server_password + auth.salt)) + auth.challenge,
            );
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (message.op === 2) resolve();
        else if (message.op === 7) obs.pending.get(message.d.requestId)?.(message.d);
      };
      obs = new Obs(ws);
    });
    return obs;
  }

  /** One request; throws on a failed status. */
  async request<T = any>(
    requestType: string,
    requestData: Record<string, unknown> = {},
  ): Promise<T> {
    const requestId = String(++this.next);
    const response = await new Promise<
      { requestStatus: { result: boolean; code: number; comment?: string }; responseData?: T }
    >((resolve) => {
      this.pending.set(requestId, resolve);
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
    this.pending.delete(requestId);
    if (!response.requestStatus.result) {
      throw new Error(
        `${requestType}: ${response.requestStatus.code} ${response.requestStatus.comment ?? ""}`,
      );
    }
    return response.responseData as T;
  }

  /** Creates or retargets an Xcomposite source for `window`, stacked above the scene's existing items. */
  async captureWindow(sceneName: string, inputName: string, window: X11Window): Promise<void> {
    const { inputs } = await this.request<{ inputs: { inputName: string }[] }>("GetInputList");
    const inputSettings = { capture_window: obsXcompositeWindow(window) };
    if (inputs.some((input) => input.inputName === inputName)) {
      await this.request("SetInputSettings", { inputName, inputSettings });
    } else {
      await this.request("CreateInput", {
        sceneName,
        inputName,
        inputKind: "xcomposite_input",
        inputSettings,
      });
    }
  }

  /** PNG of one source or scene (`Scene` for the program composite). */
  async screenshot(sourceName: string, path: string, width?: number): Promise<string> {
    await this.request("SaveSourceScreenshot", {
      sourceName,
      imageFormat: "png",
      imageFilePath: path,
      ...(width ? { imageWidth: width } : {}),
    });
    return path;
  }

  close(): void {
    this.ws.close();
  }
}

export function obsRunning(): boolean {
  return pidsNamed("obs").length > 0;
}

/** Turns the websocket server on in OBS's config; takes effect at OBS's next start. */
export function enableObsWebsocket(): boolean {
  const config = JSON.parse(Deno.readTextFileSync(WEBSOCKET_CONFIG));
  if (config.server_enabled) return false;
  config.server_enabled = true;
  Deno.writeTextFileSync(WEBSOCKET_CONFIG, JSON.stringify(config, null, 2));
  return true;
}

/**
 * Starts OBS under X11 with the websocket on. Clears a stale crash sentinel first: after a crash
 * OBS 32 otherwise waits on its safe-mode dialog even with `--disable-shutdown-check`.
 */
export async function launchObs(): Promise<void> {
  if (obsRunning()) {
    throw new Error("OBS is already running; quit it first so it restarts under X11");
  }
  enableObsWebsocket();
  try {
    for (const entry of Deno.readDirSync(`${CONFIG_DIR}/.sentinel`)) {
      if (entry.name.startsWith("run_")) Deno.removeSync(`${CONFIG_DIR}/.sentinel/${entry.name}`);
    }
  } catch {
    // No sentinel directory yet.
  }
  new Deno.Command("obs", {
    args: ["--minimize-to-tray", "--disable-shutdown-check"],
    env: { ...desktopEnv(), QT_QPA_PLATFORM: "xcb" },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn().unref();
  await waitFor(
    "the OBS websocket",
    async () => {
      try {
        (await Obs.connect()).close();
        return true;
      } catch {
        return false;
      }
    },
    60_000,
    1_000,
  );
}
