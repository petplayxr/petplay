# Finnish keycap letters render blank

Status: fixed 2026-10-12 (icon atlas plus `legendGlyph`, no submodule change)
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

## Fix (2026-10-12)

A third route that leaves the submodule alone: the PetPlay-owned icon atlas also carries Roboto's
Latin-1 (U+00A1–U+00FF) and €. Material Icons lives in the Private Use Area, so nothing collides.
`add-glyphs.py` gained `--ttf` and `--base`, and `--base 64` reproduces the Roboto atlas's own
glyph offsets exactly (checked on A, o, g and |). `legendGlyph` sends any legend outside printable
ASCII to that atlas, and the secondary (AltGr) legend now goes through it too: € was the last
oversized legend. The `finnish-legends` step of `tests/playtest/keyboard.ts` switches to `fi`,
checks that every legend fits, and types ö and ä. A close capture shows ö ä å § ¨ drawn at
letter size.

The options below were the earlier proposals, left for the record.

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
