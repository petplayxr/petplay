# Finnish keycap letters render blank

Status: open
Track: XSO parity (keyboard)

## What happens

With the Finnish legends (`Key legends: Auto` on a Finnish host layout, or `fi` picked), the
caps for ö ä å § ´ ¨ € ½ show no legend. Typing still works; only the label is missing.

The keyboard draws legends from the Roboto MSDF atlas,
`submodules/threewebxrwebgpudeno/vendor/three-msdf-text-utils/demo/fonts/roboto/roboto-regular.fnt`.
That atlas holds ASCII plus `¡¢£¤¥«` and nothing else. A run with no glyphs in the atlas draws no
quads, and its measured bounds come out as ±Infinity. uikit then scales the legend about 900×
(found by `tests/playtest/keyboard.ts`, 2026-10-12).

## Expected

Every legend in `usLayout.ts` and `fiLayout.ts` is drawn.

## Fixed so far (2026-10-12)

- ⌫ ↵ ☰ ↑ ↓ ← → (both locales) are drawn from the icon atlas instead
  (`legendGlyph` in `classes/environment/keyboard/keyboardKeyInteraction.tsx`).
- A cap whose legend once measured empty kept its broken transform after relabelling. After a
  switch from `fi` to `us`, the `` ` = [ ; ' `` legends floated metres tall above the keyboard.
  The legend `Text` is now remounted per label.

## Fix options

All of them touch the `threewebxrwebgpudeno` submodule, so the choice is left to its owner:

1. Add Latin-1 to the Roboto atlas. `resources/fonts/material-icons/add-glyphs.py` already
   appends SDF glyphs that match an msdf-bmfont atlas exactly (metrics and coverage checked
   against existing glyphs). It needs a path argument and a Roboto TTF (Roboto Regular is
   installed under `~/.local/share/fonts/windows/system/`).
2. Or register a second, PetPlay-owned text font in `MSDF_FONTS` (`msdf-text.tsx`) and in
   `MSDF_ATLAS_PATHS` (`classes/webxrRaythreeRaylibRenderer.ts`), and pick it per legend in
   `legendGlyph`.

Either way, `measureMsdfText` should also treat a run with no glyphs as zero-sized rather than
infinite, so a future missing glyph only blanks its own label.

## Repro

`deno task playtest keyboard --keep`, then in the `webxr` actor run
`setSetting("keyboardLocale", "fi")` and look for legend meshes with a world scale far above the
median (the `legends-fit` step's check).
