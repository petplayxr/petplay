/**
 * The MSDF `Text` from the uikit bridge, remounted whenever its string changes.
 *
 * uikit's `Content` keeps the bounding box of the glyph mesh it first saw, and the bridge's `Text`
 * doesn't tell it the mesh was rebuilt. New text in place is then laid out at the old text's
 * aspect and stretched to fit: a longer label overflows its box, a shorter one ("100%" -> "50%")
 * shrinks to a dot. Remounting gives `Content` a fresh box. The proper fix is in the submodule's
 * `Text` (`webgpu-uikit.tsx`).
 */
import React, { forwardRef } from "react";
import { Text as BridgeText } from "../../../submodules/threewebxrwebgpudeno/webgpu-uikit.tsx";

type TextProps = React.ComponentProps<typeof BridgeText>;

export const Text = forwardRef<unknown, TextProps>(function Text(props, ref) {
  return <BridgeText key={String(props.children ?? "")} ref={ref} {...props} />;
});
