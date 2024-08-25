import { MessageAddressReal } from "../actorsystem/types.ts";
import { Postman } from "./PostMan.ts";
import * as OpenVR from "../OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { P } from "../OpenVR_TS_Bindings_Deno/pointers.ts";
import { CustomLogger } from "./customlogger.ts";

export interface CoordState {
  id: string,
  sync: boolean,
  overlayClass: OpenVR.IVROverlay | null;
  overlayHandle: OpenVR.OverlayHandle;
  overlayError: OpenVR.OverlayError;
};

export function setOverlayTransformAbsolute(
  state: CoordState,
  transform: OpenVR.HmdMatrix34,
) {
  const overlay = state.overlayClass!;
  const transformBuffer = new ArrayBuffer(OpenVR.HmdMatrix34Struct.byteSize);
  const transformView = new DataView(transformBuffer);
  OpenVR.HmdMatrix34Struct.write(transform, transformView);
  const transformPtr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(
    transformBuffer,
  )!;

  overlay.SetOverlayTransformAbsolute(
    state.overlayHandle,
    OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding,
    transformPtr,
  );
}

export function getOverlayTransformAbsolute(state: CoordState): OpenVR.HmdMatrix34 {
  let error = state.overlayError;
  const overlay = state.overlayClass!;
  const overlayHandle = state.overlayHandle;

  const TrackingUniverseOriginPTR = P.Int32P<OpenVR.TrackingUniverseOrigin>();
  const hmd34size = OpenVR.HmdMatrix34Struct.byteSize;
  const hmd34buf = new ArrayBuffer(hmd34size);
  const hmd34view = new DataView(hmd34buf);
  const m34ptr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(hmd34buf)!;

  error = overlay.GetOverlayTransformAbsolute(
    overlayHandle,
    TrackingUniverseOriginPTR,
    m34ptr,
  );
  if (error !== OpenVR.OverlayError.VROverlayError_None) {
    CustomLogger.error(
      "actorerr",
      `Failed to get overlay transform: ${OpenVR.OverlayError[error]}`,
    );
    throw new Error("Failed to get overlay transform");
  }
  const m34 = OpenVR.HmdMatrix34Struct.read(hmd34view) as OpenVR.HmdMatrix34;

  return m34;
}

export function getOverlayLocation(state: CoordState, _payload: any, address: any) {
  const addr = address as MessageAddressReal;

  const m34 = getOverlayTransformAbsolute(state);

  Postman.PostMessage({
    address: { fm: state.id, to: addr.fm },
    type: "CB:GETOVERLAYLOCATION",
    payload: m34,
  });
}

export function setOverlayLocation(state: CoordState, payload: any, _address: any) {
  const transform = payload as OpenVR.HmdMatrix34;
  if (state.sync == false) {
    CustomLogger.log("syncloop", "set transform ");
  }
  setOverlayTransformAbsolute(state, transform);
}
