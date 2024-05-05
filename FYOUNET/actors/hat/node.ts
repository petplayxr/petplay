import { Actor } from "../../actorsystem/types.ts"
import { System } from "../actor/System.ts";

export type Vec3 = [number, number, number]
export type Transform = [Vec3, Vec3, Vec3, Vec3]

export type Pose = {
  transform: Transform,
}

export const IDENTITY: Transform = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];

// Node actor
export class Node extends Actor {
  pose: Pose = { "transform": IDENTITY }
  constructor() {
    super()
  }
  // deno-lint-ignore require-await
  async delete(ctx: System) {
    ctx.remove(this.uuid)
    console.log(`deleted`)
  }
  // deno-lint-ignore require-await
  async setPose(_: System, pose: Pose) {
    this.pose = pose
    console.log(`set pose to ${JSON.stringify(pose)}`)
  }
}
