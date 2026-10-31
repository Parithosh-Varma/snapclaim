import { apiPost } from "./api";
import type { Measurement, Payload, Session } from "./session";

/** Sample measurement (no camera): the demo fixture through /v1/measure. */
export async function loadSample(base: string, session: Session): Promise<void> {
  const sample = {
    component: { id: "wall-panel-north", areaPx: 480000, confidence: 0.93 },
    masks: [
      { id: "crack-1", label: "crack", areaPx: 24800, skeletonPx: 913, regionCount: 1, confidence: 0.88 },
      { id: "stain-1", label: "stain", areaPx: 6200, regionCount: 2, confidence: 0.71 },
    ],
    scaleReference: { id: "coin-27mm", knownMm: 27, lengthPx: 287, confidence: 0.88 },
  };
  const { res, j } = await apiPost(base, "/v1/measure", sample);
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  session.payload = sample as unknown as Payload;
  session.measurement = j.result as unknown as Measurement;
  session.autoListen = true;
}
