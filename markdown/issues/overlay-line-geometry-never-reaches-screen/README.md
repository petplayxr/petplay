# Lowered line geometry never reaches the screen in the overlay

Status: open

A `lineSegments` (raythree `bridge`) is extracted into the IR, its tube geometry uploads, and
`drawHudOverUiInstances` issues the `DrawMesh`, yet no pixels appear in the headset or in a
capture. The same box as a mesh draws fine. Grab-box chrome sidesteps it with mesh bars, but
any future line consumer is invisible in the overlay while it shows on the WebGPU surface.

Source: `docs/ARCHITECTURE.md` §9, with repro details there.
