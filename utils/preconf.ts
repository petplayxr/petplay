const versionFile = new URL(
  "../submodules/threewebxrwebgpudeno/submodules/iwer/packages/iwer/src/version.ts",
  import.meta.url,
);

try {
  await Deno.stat(versionFile);
} catch {
  await Deno.writeTextFile(versionFile, `export const VERSION = "2.5.0";\n`);
  console.log("Created iwer version.ts stub");
}

const setterSrc = new URL("./preconf/setter.ts", import.meta.url);
const setterDst = new URL(
  "../submodules/threewebxrwebgpudeno/submodules/uikit/packages/uikit/src/flex/setter.ts",
  import.meta.url,
);

try {
  await Deno.stat(setterDst);
} catch {
  await Deno.copyFile(setterSrc, setterDst);
  console.log("Copied setter.ts to uikit flex/setter.ts");
}
