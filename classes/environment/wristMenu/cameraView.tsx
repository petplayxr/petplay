import React, { useEffect, useState } from "react";
import { Container } from "../../../submodules/threewebxrwebgpudeno/webgpu-uikit.tsx";
import { measureMsdfText } from "../../../submodules/threewebxrwebgpudeno/msdf-text.tsx";
import { wrapText } from "../ui/wrapText.ts";
import { Pill } from "../ui/primitives.tsx";
import { Text } from "../ui/text.tsx";
import { COLOR, INNER_GAP, RADIUS } from "../ui/tokens.ts";
import { setSetting, useSetting, VRC_CAMERA_RESOLUTIONS } from "../../settings.ts";
import { useVrcCameraControls, useVrcCameraSnapshot } from "../vrcCameraStore.ts";

export function CameraSettingsView({ onBack }: { onBack: () => void }) {
  const snapshot = useVrcCameraSnapshot();
  const controls = useVrcCameraControls();
  const resolution = useSetting("vrcCameraResolution");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    controls?.refreshLayer().catch((e) => setError(String(e)));
    return () => clearInterval(timer);
  }, [controls]);
  const tracker = snapshot?.tracker;
  const fit = tracker?.live ? tracker.liveFit : tracker?.calibration;
  const age = tracker?.poseAgeMs == null
    ? null
    : tracker.poseAgeMs + Math.max(0, now - snapshot!.publishedAt);
  const accuracy = fit == null
    ? (tracker?.live ? "Move the camera…" : "Not calibrated")
    : `Best ${(fit.rmsErrorMeters * 100).toFixed(1)} cm · ${
      fit.rmsErrorMeters < 0.01 ? "good" : fit.rmsErrorMeters < 0.02 ? "fair" : "rough"
    }`;
  const ambiguous = fit?.otherHandRmsErrorMeters != null &&
    fit.otherHandRmsErrorMeters < fit.rmsErrorMeters + 0.01;
  const detail = tracker?.live
    ? `${
      fit
        ? `${fit.hand} hand · ${
          ambiguous
            ? "move only camera hand"
            : fit.otherHandRmsErrorMeters == null
            ? "other hand unfit"
            : `${(fit.otherHandRmsErrorMeters * 100).toFixed(0)} cm other hand`
        }`
        : "Turn through different angles"
    } · ${tracker.acceptedSamples} samples`
    : fit
    ? `${fit.hand} hand · ${tracker?.acceptedSamples || fit.samples} samples`
    : "Hold the camera while calibrating";
  const running = snapshot?.layer.running ?? false;
  const hint = !controls
    ? "Camera controls are available in the VR wrist menu."
    : age == null
    ? "Open VRChat's camera → Stream. Enable OSC."
    : tracker?.samplingPaused
    ? "Keeping best fit. Move the held camera to resume."
    : tracker?.live
    ? "Move and turn slowly. Pause to check the green ball; switch off when aligned."
    : !fit
    ? "Grab the camera, then switch Calibrate on."
    : !running
    ? "You can let go of the camera. Start the recording layer."
    : 'In OBS, capture "PetPlay VRC Camera" above VRChat’s camera.';
  const hintText = error ?? tracker?.lastError ?? hint;
  const [wrappedHint, setWrappedHint] = useState("");
  useEffect(() => {
    let cancelled = false;
    wrapText(hintText, 448, async (line) => (await measureMsdfText(line, 12)).width)
      .then((text) => {
        if (!cancelled) setWrappedHint(text);
      });
    return () => {
      cancelled = true;
    };
  }, [hintText]);
  const shownResolution = running && snapshot?.layer.width && snapshot?.layer.height
    ? `${snapshot.layer.width}x${snapshot.layer.height}`
    : resolution;
  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Container width={448} flexDirection="column" gap={INNER_GAP}>
      <Container flexDirection="row" gap={INNER_GAP}>
        <Pill slots={1} units={2} fontSize={14} onClick={onBack}>BACK</Pill>
        <Pill slots={3} units={2} tone="accent" fontSize={14}>VRC CAMERA</Pill>
      </Container>
      <Container
        flexDirection="column"
        gap={6}
        padding={INNER_GAP}
        backgroundColor={COLOR.tile}
        backgroundOpacity={1}
        borderRadius={RADIUS.tile}
      >
        <Text fontSize={14} color={COLOR.ink}>
          {age == null
            ? "VRChat camera · not seen"
            : `VRChat camera · ${age < 2000 ? "live" : `seen ${Math.floor(age / 1000)} s ago`}${
              tracker?.fovYDeg ? ` · ${tracker.fovYDeg.toFixed(0)}°` : ""
            }`}
        </Text>
      </Container>
      <Container
        flexDirection="column"
        gap={6}
        padding={INNER_GAP}
        backgroundColor={COLOR.tile}
        backgroundOpacity={1}
        borderRadius={RADIUS.tile}
      >
        <Container flexDirection="row" alignItems="center" justifyContent="space-between">
          <Container flexDirection="column" gap={4}>
            <Text fontSize={14} color={COLOR.ink}>Calibrate</Text>
            <Text fontSize={13} color={COLOR.ink}>{accuracy}</Text>
          </Container>
          <Container flexDirection="row" gap={INNER_GAP}>
            {!tracker?.live && fit && (
              <Pill
                slots={1}
                units={2}
                fontSize={12}
                disabled={!controls}
                onClick={() => controls?.clear()}
              >
                CLEAR
              </Pill>
            )}
            <Pill
              slots={1}
              units={2}
              fontSize={13}
              disabled={!controls}
              tone={tracker?.live ? "accent" : "outline"}
              onClick={() => controls?.setLive(!tracker?.live)}
            >
              {tracker?.live ? "ON" : "OFF"}
            </Pill>
          </Container>
        </Container>
        <Text fontSize={12} color={COLOR.inkDim}>{detail}</Text>
      </Container>
      <Container
        flexDirection="column"
        gap={6}
        padding={INNER_GAP}
        backgroundColor={COLOR.tile}
        backgroundOpacity={1}
        borderRadius={RADIUS.tile}
      >
        <Text fontSize={14} color={COLOR.ink}>Recording layer</Text>
        <Container flexDirection="row" gap={INNER_GAP} justifyContent="space-between">
          <Pill
            slots={2}
            units={2}
            fontSize={13}
            disabled={busy || running}
            onClick={() =>
              setSetting(
                "vrcCameraResolution",
                VRC_CAMERA_RESOLUTIONS[
                  (VRC_CAMERA_RESOLUTIONS.indexOf(resolution) + 1) % VRC_CAMERA_RESOLUTIONS.length
                ],
              )}
          >
            {shownResolution}
          </Pill>
          <Pill
            slots={1}
            units={2}
            fontSize={13}
            disabled={!controls || busy}
            tone={running ? "accent" : "outline"}
            onClick={() => controls && void action(() => controls.setLayer(!running))}
          >
            {busy ? "WAIT" : running ? "STOP" : "START"}
          </Pill>
        </Container>
      </Container>
      <Text fontSize={12} color={COLOR.inkDim}>{wrappedHint}</Text>
    </Container>
  );
}
