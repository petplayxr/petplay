/**
 * The synthetic OpenVR driver running inside a lab SteamVR (`utils/petplay-ovrdriver-lab.py`).
 * Attaches to its control socket; poses are in raw tracking space, rotations XYZW.
 *
 * One control connection is served at a time, so close the handle when done.
 */
import * as THREE from "three";
import { type ActorId, PostalService } from "../../submodules/stageforge/mod.ts";
import { attachOpenVrDriverProxy } from "../../classes/petplayOpenVrDriverProxy.ts";
import { sleep } from "./util.ts";

export type Hand = "left" | "right";
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type HandPose = { position: Vec3; rotation: Quat };
/** Complete input state for one hand; omitted controls are released. `a`/`b` are X/Y on the left. */
export type HandInput = {
  trigger?: number;
  grip?: number;
  joystick?: [number, number];
  joystickClick?: boolean;
  a?: boolean;
  b?: boolean;
  system?: boolean;
};

const STEAMVR_SETTINGS = `${Deno.env.get("HOME")}/.local/share/Steam/config/steamvr.vrsettings`;

export function labSocketPath(): string {
  const settings = JSON.parse(Deno.readTextFileSync(STEAMVR_SETTINGS));
  const directory = settings.driver_petplay?.socketDirectory;
  if (!directory || settings.steamvr?.forcedDriver !== "petplay") {
    throw new Error("no synthetic lab session: start one with `deno task vrlab up`");
  }
  return `${directory}/control.sock`;
}

/** Euler radians (XYZ order) to an XYZW quaternion. */
export function euler(x: number, y: number, z: number): Quat {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

export class SyntheticDriver {
  private constructor(private readonly postal: PostalService, private readonly id: ActorId) {}

  static async attach(socketPath = labSocketPath()): Promise<SyntheticDriver> {
    const postal = new PostalService();
    const id = await attachOpenVrDriverProxy(postal, socketPath);
    return new SyntheticDriver(postal, id);
  }

  async send<T = unknown>(type: string, payload: unknown = null): Promise<T> {
    const result = await this.postal.PostMessage({ target: this.id, type, payload }, true) as
      | (T & { __actorError?: { message: string } })
      | null;
    if (result && typeof result === "object" && "__actorError" in result && result.__actorError) {
      throw new Error(`${type}: ${result.__actorError.message}`);
    }
    return result as T;
  }

  /** Holds `hand` at `pose` until {@link release} or another pose. */
  setPose(hand: Hand, pose: HandPose): Promise<unknown> {
    return this.send("SETCONTROLLERPOSE", {
      hand,
      position: pose.position,
      rotation: pose.rotation,
    });
  }

  /** Returns `hand` to the analytic trajectory. */
  release(hand: Hand): Promise<unknown> {
    return this.send("SETCONTROLLERPOSE", { hand, clear: true });
  }

  setInput(hand: Hand, input: HandInput = {}): Promise<unknown> {
    return this.send("SETCONTROLLERINPUT", { hand, ...input });
  }

  /**
   * Holds `input` for `ms`, then restores `after`. Apps sample input once per frame, so a press
   * needs at least a few frames: about 150 ms for a tap; VRChat treats ~900 ms on the menu button
   * as a hold (Action Menu) and a short tap as the Quick Menu.
   */
  async press(hand: Hand, input: HandInput, ms = 150, after: HandInput = {}): Promise<void> {
    await this.setInput(hand, input);
    await sleep(ms);
    await this.setInput(hand, after);
  }

  /** Current driver-side state: the poses the driver publishes, before any app-side pose binding. */
  state(): Promise<{
    hands: {
      role: Hand;
      held: boolean;
      inputs: HandInput;
      pose: { vecPosition: Vec3; qRotation: { x: number; y: number; z: number; w: number } };
    }[];
  }> {
    return this.send("GETCONTROLLERSTATE");
  }

  async handPose(hand: Hand): Promise<HandPose> {
    const pose = (await this.state()).hands[hand === "left" ? 0 : 1].pose;
    const q = pose.qRotation;
    return { position: [...pose.vecPosition], rotation: [q.x, q.y, q.z, q.w] };
  }

  /**
   * Streams `path(t)` for `seconds` at roughly 60 Hz. Smooth motion, not jumps: apps (and the VRC
   * camera calibrator's stillness gate) see velocity, and VRChat only reports a held camera's pose
   * while it moves.
   */
  async follow(hand: Hand, seconds: number, path: (t: number) => HandPose): Promise<void> {
    const start = performance.now();
    for (;;) {
      const t = (performance.now() - start) / 1000;
      if (t > seconds) return;
      await this.setPose(hand, path(t));
      await sleep(15);
    }
  }

  close(): void {
    this.postal.detachProxy(this.id);
  }
}
