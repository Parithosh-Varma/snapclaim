import { resetDmg, type Session } from "./session";

/** Shipped field photos for the no-camera path (react/public/samples/). */
export const SAMPLE_PHOTOS: { file: string; label: string }[] = [
  { file: "dsc_0682.jpg", label: "Facade crack" },
  { file: "dsc_0683.jpg", label: "Wall crack" },
  { file: "dsc_0684.jpg", label: "Hairline crack" },
  { file: "dsc_0685.jpg", label: "Horizontal crack" },
  { file: "dsc_0686.jpg", label: "Floor crack" },
  { file: "dsc_0687.jpg", label: "Thin wall crack" },
  { file: "dsc_0688.jpg", label: "Tiled floor cracks" },
  { file: "dsc_0690.jpg", label: "Weathered crack" },
  { file: "dsc_0691.jpg", label: "Long wall crack" },
  { file: "dsc_0692.jpg", label: "Peeling paint" },
  { file: "dsc_0693.jpg", label: "Stained crack" },
  { file: "dsc_0694.jpg", label: "Panel seams" },
  { file: "dsc_0695.jpg", label: "Panel joints" },
  { file: "dsc_0697.jpg", label: "Floor crack" },
  { file: "dsc_0698.jpg", label: "Concrete crack" },
  { file: "dsc_0699.jpg", label: "Edge crack" },
];

export function sampleUrl(file: string): string {
  return `./samples/${file}`;
}

/**
 * Load a shipped sample photo as the claim still. The damage is then marked
 * and measured for real — unlike the old synthetic fixture, the photo panel
 * is never blank.
 */
export async function loadSamplePhoto(session: Session, file: string): Promise<void> {
  const res = await fetch(sampleUrl(file));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("could not read the sample photo"));
    reader.readAsDataURL(blob);
  });
  session.stillDataUrl = dataUrl;
  session.photo = null;
  session.photoFor = "";
  session.gateCoin = null;
  session.coinLabel = "";
  session.coinKindMm = 0;
  session.coinManualPt = null;
  session.coinMask = null;
  session.coinIou = 0;
  session.noScaleMode = false;
  session.dmgLabel = "crack";
  resetDmg(session);
  session.payload = null;
  session.measurement = null;
  session.transcript = "";
  session.currentCaseId = null;
  session.annexUrl = null;
  session.autoListen = false;
}
