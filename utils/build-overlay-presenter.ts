import { fromFileUrl } from "@std/path";
const root = new URL("../", import.meta.url);
if (Deno.build.os !== "linux") {
  throw new Error("The experimental native presenter currently supports Linux only");
}
const source = fromFileUrl(new URL("native/overlayPresenter/presenter.cpp", root));
const output = fromFileUrl(new URL("resources/libpetplay_overlay_presenter.so", root));
const result = await new Deno.Command(Deno.env.get("CXX") ?? "c++", {
  args: ["-std=c++17", "-O2", "-fPIC", "-shared", source, "-lGL", "-o", output],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!result.success) Deno.exit(result.code);
console.log(`Built ${output}`);
