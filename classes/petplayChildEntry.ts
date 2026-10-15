/** Dev children use the same Linux startup policy as the compiled dispatch entry. */
import { dispatchChildModule } from "./childModule.ts";
import { initializeLinuxScheduling } from "./linuxScheduling.ts";

initializeLinuxScheduling();
if (await dispatchChildModule(Deno.args) == null) {
  throw new Error("PetPlay child entry requires --petplay-run-module=<href>");
}
