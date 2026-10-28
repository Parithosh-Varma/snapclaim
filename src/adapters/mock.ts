import type { FindingsProvider, FindingsRequest, VisionProvider, VisionRequest, VisionResult } from "./types.ts";
import type { FindingDraft } from "../findings/evidence-gate.ts";

/** Returns the recorded fixture. Used by every test and by the offline demo mode. */
export class MockVisionProvider implements VisionProvider {
  readonly #fixture: VisionResult;

  constructor(fixture: VisionResult) {
    this.#fixture = fixture;
  }

  async segment(_request: VisionRequest): Promise<VisionResult> {
    return structuredClone(this.#fixture);
  }
}

/**
 * Deterministic stand-in for Muse Spark. It only writes sentences that cite
 * receipt values exactly, which is what the evidence gate will demand later.
 */
export class MockFindingsProvider implements FindingsProvider {
  async draftFindings(request: FindingsRequest): Promise<FindingDraft[]> {
    return request.findings.map((finding) => {
      const citations = [
        finding.receiptIds.ratio,
        finding.receiptIds.regions,
        finding.receiptIds.severity,
      ];
      if (finding.receiptIds.length !== null) {
        citations.push(finding.receiptIds.length);
      }
      if (finding.receiptIds.area !== null) {
        citations.push(finding.receiptIds.area);
      }
      if (finding.receiptIds.width !== null) {
        citations.push(finding.receiptIds.width);
      }

      const parts = [`${finding.label} covers ${finding.percent}% of the component`];
      if (finding.crackLengthMm !== null) parts.push(`measures ${finding.crackLengthMm} mm`);
      if (finding.areaCm2 !== null) parts.push(`covers ${finding.areaCm2} cm2`);
      if (finding.crackWidthMm !== null) parts.push(`averages ${finding.crackWidthMm} mm wide`);
      parts.push(`classified ${finding.severity}`);
      return { statement: parts.join("; ") + ".", citations };
    });
  }
}
