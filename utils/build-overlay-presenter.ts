import { fromFileUrl } from "@std/path";
const root = new URL("../", import.meta.url);
if (Deno.build.os !== "linux") {
  throw new Error("The experimental native presenter currently supports Linux only");
}
const source = fromFileUrl(new URL("native/overlayPresenter/presenter.cpp", root));
const output = fromFileUrl(new URL("resources/libpetplay_overlay_presenter.so", root));
// Build beside the library and rename over it: a running renderer keeps its mapped copy.
const temporary = `${output}.${Deno.pid}.tmp`;
const result = await new Deno.Command(Deno.env.get("CXX") ?? "c++", {
  args: ["-std=c++17", "-O2", "-fPIC", "-shared", source, "-lGL", "-o", temporary],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!result.success) Deno.exit(result.code);
Deno.renameSync(temporary, output);
console.log(`Built ${output}`);
