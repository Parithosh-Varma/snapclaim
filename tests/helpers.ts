import { readFileSync } from "node:fs";
import { measureSession } from "../src/engine/measure.ts";
import type { MeasuredFinding } from "../src/engine/types.ts";
import type { FindingDraft } from "../src/findings/evidence-gate.ts";
import type { ComponentObservation, MaskObservation, ScaleReference } from "../src/engine/types.ts";

export interface WallFixture {
  imageId: string;
  component: ComponentObservation;
  masks: MaskObservation[];
  scaleReference: ScaleReference;
}

export function loadWallFixture(): WallFixture {
  const raw = readFileSync(new URL("../fixtures/masks/wall-crack.json", import.meta.url), "utf8");
  return JSON.parse(raw) as WallFixture;
}

/** What a well-behaved model replies: one sentence per finding, citing its receipts exactly. */
export function wallSession() {
  const f = loadWallFixture();
  return measureSession({ component: f.component, masks: f.masks, scaleReference: f.scaleReference });
}

export function citingDrafts(findings: MeasuredFinding[]): FindingDraft[] {
  return findings.map((finding) => {
    const citations = [finding.receiptIds.ratio, finding.receiptIds.regions, finding.receiptIds.severity];
    if (finding.receiptIds.length !== null) citations.push(finding.receiptIds.length);
    const statement =
      finding.crackLengthMm === null
        ? `${finding.label} covers ${finding.percent}% of the component; classified ${finding.severity}.`
        : `${finding.label} covers ${finding.percent}% of the component and measures ${finding.crackLengthMm} mm; classified ${finding.severity}.`;
    return { statement, citations };
  });
}

/** Stubs only the network: the real Meta/Baseten provider code parses this chat-completion reply. */
export function modelFetch(drafts: FindingDraft[]): typeof fetch {
  return (async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(drafts) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as typeof fetch;
}

export const LIVE_ENV = { MOCK_MODE: "0", META_API_KEY: "test", BASETEN_API_KEY: "test" };
