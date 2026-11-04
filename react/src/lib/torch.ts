// Flashlight (torch) control for the capture screen. Small, dependency-free
// wrappers around the WebRTC torch constraint so the logic stays
// unit-testable with fake tracks. Torch support is Android-Chrome-first:
// iOS Safari reports no `torch` capability, so the UI hides there.
export interface TorchCapableTrack {
  getCapabilities?: () => unknown;
  applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
}

/** True only when the track explicitly advertises torch control. */
export function torchSupported(track: TorchCapableTrack | null | undefined): boolean {
  try {
    const caps = track?.getCapabilities?.() as { torch?: unknown } | null | undefined;
    return caps?.torch === true;
  } catch {
    return false;
  }
}

/** Flip the torch; throws when the track cannot do it. */
export async function setTorch(
  track: TorchCapableTrack | null | undefined,
  on: boolean,
): Promise<void> {
  if (!track?.applyConstraints) throw new Error("torch unsupported");
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}
