# PetPlay OpenVR driver: programmable devices and unattended experiments

16 October 2026. Design and offline ABI spike; no driver installed or registered.
SteamVR was shut down after ordered PetPlay detach. Keep physical HMD output off while
building this. Long unattended runs should use a synthetic HMD rather than keeping a real
headset's compositor active through standby.

## Purpose

Provide a reusable driver controlled by PetPlay for synthetic HMD/controller devices,
replayable motion and inputs, and runtime-facing telemetry. The first use is comparing
panorama and projection with the same controller trajectory passing through SteamVR's
tracking/prediction path, without someone wearing a headset or moving controllers.

This is different from the renderer-side motion probe: that probe bypasses SteamVR's
controller tracking and prediction. Retain both controls so driver/input defects can be
separated from rendering/publication defects.

## ABI and process boundary

OpenVR loads `HmdDriverFactory` from a native shared library. That C entry point returns a
C++ `IServerTrackedDeviceProvider` object; each device implements `ITrackedDeviceServerDriver`.
The provider receives an `IVRDriverContext` to acquire driver-side runtime interfaces.
The application's existing OpenVR client FFI bindings are not a ready-made driver interface.

Initial adapter-based layout (superseded by the pure-Zig investigation below):

```
PetPlay actor (Deno)
    | local IPC: configure devices, upload trajectory, start/stop, query telemetry
    v
Zig core inside driver_petplay.so (vrserver process)
    | small, explicit C ABI with plain structs/opaque handles/callbacks
    v
C++ adapter compiled against pinned Valve openvr_driver.h
    | provider/device virtual interfaces and driver-host calls
    v
SteamVR tracking, input, compositor
```

In this adapter-based option, C++ would own the official virtual-interface objects and convert OpenVR structs. Zig would
own device state, trajectory evaluation, command parsing, timestamping and bounded telemetry.
Zig can compile/link the C++ adapter. A pure Zig implementation with hand-written vtables is
possible in principle, but would require maintaining C++ ABI details for each supported target.
There is no benefit to making that the first dependency of the investigation.

`Deno.dlopen` cannot call the already-loaded driver instance in another process. Loading the
same file in PetPlay creates separate state. IPC is the application-to-driver control path;
FFI remains useful internally across the C++/Zig boundary or for a future client helper.
Avoid introducing Deno, JS execution, renderer assets or UI code into vrserver.

The driver API is public OpenVR, rather than a private compositor integration. Pin interface
versions and fail clearly on incompatibility. It does not expose an atomic overlay publication
operation or fix the frame-pacing issue merely by existing.

## Device modes

1. **Virtual lab:** one synthetic HMD and two synthetic controllers. No physical display driver
   should be selected. Exercise real SteamVR tracking, prediction, controller roles and input.
2. **Companion:** synthetic controllers/trackers alongside a real HMD for later validation.
   Multiple-driver activation must be explicit, and controller-role conflicts must be handled.
   No synthetic HMD in this mode; no global driver policy changes during normal PetPlay startup.

Start with the virtual lab. A controller-only driver would still leave the unattended real
headset problem unresolved. The lab's optics are a named profile, not an assertion that its
compositor timing is identical to physical hardware. Copy the measured real HMD's refresh
rate, eye transforms, raw projection bounds, render size, IPD and prediction offset as one
profile; also support deliberately different refresh rates to test assumptions.

Properties affecting compositor setup should initially be startup configuration. Do not
promise seamless hot changes to display frequency or optics before testing runtime behavior.

## First milestones and acceptance checks

### 1. Native shell, no devices

Export the factory; initialize/clean up driver context; report compatible interface versions;
return explicit errors for unsupported requests. Prove C++ virtual calls reach Zig. Exercise
this offline before loading anything into SteamVR. Then verify provider initialization in a
controlled runtime session, without adding devices yet.

### 2. Driver control and lifecycle

Use a local Unix-domain socket on Linux, restricted to the current user. Keep protocol framing,
version, maximum command size, request ID and response/error status explicit. A Windows named
pipe can implement the same logical protocol later. Start with configure, status, stop/reset,
and trajectory-start commands. Commands that mutate runtime/device state enter a bounded queue.
Do not block `RunFrame` on socket operations. Reject malformed/non-finite poses, non-unit
quaternions, invalid rates and unsupported configuration before applying them.

Use a session ID and monotonic timestamps; include clock-domain metadata. On disconnect or
expiry, use an explicit hold/disconnect policy, never keep publishing stale nonzero velocity.
On driver cleanup: stop workers, join them before context teardown, release resources, and
remove the endpoint. Multiple native processes may eventually load driver components; ownership
of any endpoint must follow the actual component/process, not a single-global-process assumption.

### 3. Synthetic HMD and display bring-up

Implement a fixed HMD pose and display geometry using the official simple-HMD sample as a
starting point. **Linux output is an explicit feasibility gate:** prove vrcompositor runs
with this HMD and physical drivers unselected. A desktop debug/extended display may be the
first working output; truly surfaceless operation is a separate requirement.

Verify effective refresh rate, optical properties, tracking validity, frame counter progression,
WaitFrameSync cadence and power behavior. Report simulated proximity/activity appropriately;
`ShouldBlockStandbyMode` is deprecated and is not a solution to standby.

Do not treat `RunFrame` as a display clock. It is a vrserver callback. Use a monotonic clock
and absolute deadlines for trajectory sampling and any simulated display timing, following
the selected display component's contract. Changing a refresh-rate property alone does not
implement a display or prove that SteamVR follows our clock.

### 4. Synthetic controllers and input

Register left/right controllers with stable serials and proper input profiles/role properties.
Publish position, rotation, analytic linear/angular velocity and the sample's actual time offset
through `TrackedDevicePoseUpdated`. Start with stationary and sinusoidal trajectories; add
record/replay afterward. Use `IVRDriverInput` for trigger, grip, buttons and joystick.

Upload a trajectory once and evaluate it inside the driver. Avoid a JS/IPC round trip for every
tracking sample; IPC scheduling should not become artificial controller jitter. Advance by
elapsed monotonic time, never by callback count. Record commanded samples alongside poses
observed through the ordinary client API at specified prediction horizons.

### 5. Overlay comparison and output observability

Run the same renderer-side diagnostic scene with its synthetic tracking override disabled;
anchor the marker to the driver's controller pose. Compare projection and panorama, resolution,
source rotation, prediction horizon and representative workload, including VRChat home.
Decode render-generation markers from compositor-consumed images to distinguish duplicate or
skipped generations from irregular pose samples. Keep tracking, publication and consumption
logs separate and join them using explicit IDs/timestamps.

`IVRVirtualDisplay` offers final-backbuffer and timing callbacks in the public API, making it
an interesting later capture/sink route. Do not assume its shared-texture transport works on
Linux or that its handles are directly importable by our GL/Vulkan tools. Validate that path
before promising automatic output capture. An `IVRDisplayComponent` implementation alone does
not provide a final-image capture callback. RenderDoc remains a separate diagnostic fallback;
capture perturbation limits conclusions about normal cadence.

## Offline result

Zig 0.16.0 is installed. An ignored local spike at `_scratch/driver-abi/` compiles a Zig core
and a C++ provider adapter into one shared library using:

```sh
zig build-lib _scratch/driver-abi/core.zig _scratch/driver-abi/adapter.cpp \
  -I/home/ellie/git/openvr/headers -lc++ -dynamic \
  -femit-bin=_scratch/driver-abi/driver_petplay_probe.so
```

The test loads the factory, rejects an unsupported interface, calls the provider's virtual
methods and verifies three RunFrame callbacks reached Zig. Its stub Init does not initialize
a runtime context and it registers no devices; it must not be installed as a working driver.
This checks the proposed language boundary, not runtime compatibility or synthetic display
support. A production build should vendor/pin the official SDK header/license instead of
relying on a sibling checkout.

No SteamVR registration, null-driver toggle or persistent driver configuration was
performed during the ABI spike. Any later test-mode launcher should snapshot and restore settings exactly, with
an independent recovery path for interrupted sessions.

## Primary references

- [Valve driver API documentation](https://github.com/ValveSoftware/openvr/blob/master/docs/Driver_API_Documentation.md)
- [Official driver header](https://github.com/ValveSoftware/openvr/blob/master/headers/openvr_driver.h)
- [Official simple-HMD example](https://github.com/ValveSoftware/openvr/tree/master/samples/drivers/drivers/simplehmd)
- [Official controller example](https://github.com/ValveSoftware/openvr/tree/master/samples/drivers/drivers/simplecontroller)


## Follow-up: avoid a runtime C++ adapter

The user prefers an entirely Zig driver. Online research found concrete direct-ABI techniques;
the C++ adapter is an implementation option, not an OpenVR requirement. Investigate a pure Zig
implementation first, targeting Linux x86-64 initially. Keep a C++ executable only as an offline
compatibility test compiled against Valve's header, with no C++ object code in the driver itself.
The existing mixed-language spike proves only its own approach, not this pure Zig approach.

Relevant primary resources:

- [kassane/CxxInterop-tests: cats.zig](https://github.com/kassane/CxxInterop-tests/blob/devel/bindgen/zig/cats.zig)
  directly imports mangled C++ constructors/methods with `@extern` and explicit self arguments,
  selecting MSVC versus Itanium-style symbol names. Concrete shim-free calling example, not
  a virtual-interface implementation. Its Zig syntax predates the installed compiler.
- [zigwin32's IUnknown implementation](https://github.com/marlersoft/zigwin32/blob/main/win32/system/com.zig#L5079)
  represents a COM object as a pointer to an explicit function-pointer vtable, with explicit
  self parameters. No C++ forwarding shim for these calls. COM has its own ABI contract; do
  not copy its Windows calling convention or assume it specifies Linux OpenVR behavior.
- [lassade/c2z](https://github.com/lassade/c2z) has a target-specific `-no-glue` mode, but its
  README explicitly excludes Zig-side inheritance and notes manual adjustments. It may help
  generate declarations; it does not by itself solve exporting our provider/device objects.
- [Itanium C++ ABI, virtual-table layout](https://itanium-cxx-abi.github.io/cxx-abi/abi.html#vtable)
  documents the layout relevant to the Linux ABI, including address points and negative-offset
  metadata. Our interfaces are simpler than arbitrary C++ inheritance, but layout and call
  compatibility must still be checked against actual compiler-generated consumers.
- [zig-gamedev/zopenvr](https://github.com/zig-gamedev/zopenvr) is a work-in-progress application
  binding targeting OpenVR 2.2.3. Its published interface list does not establish server-driver
  support. Do not mistake client bindings for a reusable provider implementation.
- [Jonathan Marler's Zig C++ interop article](https://marler8997.github.io/blog/zig-cpp-interop/)
  uses sized opaque storage plus C++ helper functions; useful for layout checks, but not an
  example meeting the no-C++-shim preference.

No ready-made pure Zig OpenVR driver was identified in this search. This is a search result,
not proof none exists. The practical candidate is manually defined, versioned driver vtables:
export the C factory from Zig; return Zig-owned interface objects; define runtime-host/context
interfaces similarly for calls back into SteamVR. No mangled-symbol lookup is needed for calls
that go through supplied interface pointers.

Next offline acceptance test: a pure Zig shared library implementing the provider, consumed
through the actual C++ header; verify all provider slots, argument/return values and lifecycle.
Then test the reverse direction with a C++ fake driver context/host and Zig calling their
vtables. Include `ITrackedDeviceServerDriver::GetPose` returning `DriverPose_t` by value and
compare struct size/alignment/offsets. Hidden struct-return arguments and platform-specific
member-call conventions need explicit attention; scalar-only success is insufficient.
Do not assume Linux success proves Windows compatibility. RTTI/dynamic_cast support is also
not implied by successful virtual dispatch; define and test the supported boundary explicitly.


## Implemented first milestone: petplay_ovrdriver

The separate project now lives at `submodules/petplay_ovrdriver`. See its README and
ARCHITECTURE.md for the current contract. The shared library is pure Zig; C++ is used only by
an offline consumer of the official pinned header. Provider/device virtual calls, reverse
context/host calls, DriverPose_t layout and return-by-value, lifecycle and error paths pass
in Debug and ReleaseSafe. The driver has no libc/libc++ dependency and registers no devices.

The transport-independent Stageforge side is implemented in Zig. Its standalone actor host
registers with the real PostalService, handles addressed callbacks and native dispatch errors,
and roundtrips Unicode/BigInt tags. Bounded stream/framing and malformed-message recovery are
also tested. This proves protocol interoperability, not a live driver connection: the next
milestone is an authenticated externally-owned transport into the vrserver-loaded instance,
with connection shutdown separated from SteamVR process lifetime. The native driver must not
be treated as an IPCWorker-owned process.

From PetPlay: `deno task driver:build` or `deno task driver:test`. SteamVR remains stopped.
The submodule initially uses a local sibling repository; no remote repository is created or
published by this work. Previous renderer-side motion-probe work remains a separate change.


## Externally owned proxy milestone

The live driver connection is now implemented, with the same ownership model as Iroh's
existing-actor proxies. The driver establishes identity during provider Init and announces it
on a private user-only Unix-domain socket. PetPlay imports it via `attachOpenVrDriverProxy`;
there is no actor INIT/LOADED on attachment. Stageforge now records external ownership,
generalizes proxy attachment, routes replies, and detaches external connections during murder
or graph reboot without sending shutdown to the peer. Reload requires explicit reattachment.

The socket was chosen over WebSocket for the first Linux transport: Stageforge's message
semantics remain the same, while framing is bounded newline-delimited JSON. File permissions,
peer UID checks and an exclusive owner lock protect the local endpoint. IPC parsing runs on
a dedicated pthread-backed Zig thread; Cleanup joins it before context release. libc is now
required for safe threading inside a foreign process; no C++ runtime or adapter is needed.

The actual shared library and real Stageforge router pass offline socket tests for stable
identity/state across detach/reattach, pending callback rejection, prompt cleanup while connected,
owner contention and insecure-directory refusal. This is verified in a mock vrserver process,
not a SteamVR session. Physical HMD remains off. No synthetic devices, automatic startup,
SteamVR driver registration or network publishing are added by this milestone.
