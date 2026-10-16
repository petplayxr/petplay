# Steam Frame controller bindings

PetPlay ships a native `frame_controller` binding in `resources/bindings_frame_controller.json`,
selected by `resources/actions.json`. Controller selection follows SteamVR's device type, not
the HMD name, so the same bindings apply when Frame controllers are used with another headset.

The mapping targets PetPlay's existing actions:

| Control | Action |
| --- | --- |
| Trigger click, either hand | Select / left click |
| Grip click, either hand | Grab / squeeze |
| Thumbstick, either hand | Existing scroll and push/pull interaction |
| Touch left D-pad down or right A | Right-click modifier |
| Touch left D-pad up or right B | Middle-click modifier |
| Raw tracked pose, either hand | Hand pose |
| Haptic output, either hand | Existing haptic feedback |

Other face buttons, bumpers and menu/system buttons are not assigned new PetPlay behavior.
Skeletal/finger tracking is not consumed by the current action manifest.

## Sources and validation

Valve's [Steam Frame Input documentation](https://partner.steamgames.com/doc/steamhardware/steamframe/input)
specifies the OpenVR controller type and per-hand input paths. OpenVR uses `/input/grip`, while
the OpenXR profile calls the corresponding input `squeeze`; these names must not be mixed.
The left controller has D-pad buttons, while ABXY are all on the right. The modifier choices
above are PetPlay's mappings, not Valve defaults.

Paths were also checked against the genuine recovery image's
`/opt/steamvr/drivers/frame_controller/resources/input/frame_controller_profile.json`
(SteamVR 2.17.10; SHA-256
`0cbb52f75d041a1e1d5a642f1d56373170c54b0862bd1391ce16aa49b0859be6`).
No Valve profile or driver is redistributed here.

`classes/actionBindings.test.ts` checks handed input paths, action references, required pose/
haptic mappings, and staging every manifest binding beside runtime action manifests, including
when an older binding is already staged. The binding is source/profile validated; physical
Steam Frame controller verification remains pending.

## DroidFrame is a separate profile

The `droidframe_quest` engineering binding uses different component names and analog thresholds.
The user confirmed that trigger clicks and grabs work with that binding on 2026-10-16. This
confirms the Quest bridge workaround, not native Frame controller support. Accurate emulation
of the Frame profile is tracked in the DroidFrame repository's
`droidframe/issues/steam-frame-controller-fidelity.md`.
