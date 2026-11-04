// Overlap helpers: the measurement started on Mark runs in the background
// while the user is on Say. No maths changes here - the observe body is built
// exactly as the old sequential flow built it, so receipts are identical for
// the same inputs. Only the timing moves: Mark navigates to Say immediately
// and Say awaits the job before /v1/report.
//
// The promise itself is transient (never drafted); only completed
// payload/measurement persist via the existing draft fields.
import { circleRle, encodeRle } from "./rle.ts";
import type { Measurement, MeasureJob, Payload, Session } from "./session.ts";

export interface ObserveBody {
  body: Record<string, unknown>;
  /** Synchronous refusal: stays on Mark with this status, no job started. */
  refused?: string;
}

/** Build the /v1/observe body from the current taps/coin. Identical to the
 *  old sequential Mark.measure() maths: SAM-traced coin outline wins, the
 *  gate circle is legacy-draft only, percent-only is explicit. */
export function buildObserveBody(s: Session, w: number, h: number): ObserveBody {
  const body: Record<string, unknown> = {
    masks: [{ id: "damage-1", label: s.dmgLabel, rle: encodeRle(s.dmg.mask as Uint8Array, w, h), confidence: s.dmg.iou || 0.8 }],
  };
  if (s.coinManualPt && s.coinMask) {
    body.reference = { id: "coin", rle: encodeRle(s.coinMask, w, h), knownMm: s.coinKindMm, confidence: s.coinIou };
  } else if (s.coinManualPt) {
    return { body, refused: "Tap the coin again - the last outline missed the coin." };
  } else if (s.gateCoin) {
    const kx = w / s.gateCoin.sw;
    const ky = h / s.gateCoin.sh;
    body.reference = {
      id: "coin",
      rle: circleRle(
        (s.gateCoin.cx / s.gateCoin.fw) * s.gateCoin.sw * kx,
        (s.gateCoin.cy / s.gateCoin.fh) * s.gateCoin.sh * ky,
        Math.max(3, (s.gateCoin.rr / s.gateCoin.fw) * s.gateCoin.sw * kx),
        w,
        h,
      ),
      knownMm: s.coinKindMm,
      confidence: 0.85,
    };
  } else if (s.noScaleMode) {
    body.note = "percent-only requested";
  }
  return { body };
}

/** Snapshot the inputs a job was started with, for staleness on completion. */
export function snapshotInputs(s: Session): Omit<MeasureJob, "seq" | "state" | "error" | "promise"> {
  return {
    photoFor: s.photoFor,
    points: s.dmg.points.map(([x, y]) => [x, y] as [number, number]),
    coinKindMm: s.coinKindMm,
    noScaleMode: s.noScaleMode,
    coinPt: s.coinManualPt ? ([...s.coinManualPt] as [number, number]) : null,
    hasGateCoin: !!s.gateCoin,
    dmgLabel: s.dmgLabel,
  };
}

function samePt(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/** True when the session's current inputs still match the job's snapshot. */
export function inputsMatch(s: Session, job: Pick<MeasureJob, "photoFor" | "points" | "coinKindMm" | "noScaleMode" | "coinPt" | "hasGateCoin" | "dmgLabel">): boolean {
  if (s.photoFor !== job.photoFor) return false;
  if (s.coinKindMm !== job.coinKindMm) return false;
  if (s.noScaleMode !== job.noScaleMode) return false;
  if (s.dmgLabel !== job.dmgLabel) return false;
  if (s.gateCoin && !job.hasGateCoin) return false;
  if (!s.gateCoin && job.hasGateCoin) return false;
  if (!samePt(s.coinManualPt, job.coinPt)) return false;
  if (s.dmg.points.length !== job.points.length) return false;
  for (let i = 0; i < s.dmg.points.length; i++) {
    const a = s.dmg.points[i] as [number, number];
    const b = job.points[i] as [number, number];
    if (a[0] !== b[0] || a[1] !== b[1]) return false;
  }
  return true;
}

/** Current = same object, same seq, inputs untouched. */
export function isCurrentJob(s: Session, job: MeasureJob): boolean {
  return s.measureJob === job && job.seq === s.measureSeq && inputsMatch(s, job);
}

/** Start a background job: bumps the seq so any older landing is stale. */
export function startMeasureJob(s: Session, promise: Promise<void>): MeasureJob {
  s.measureSeq = (s.measureSeq ?? 0) + 1;
  const job: MeasureJob = {
    seq: s.measureSeq,
    state: "running",
    promise,
    ...snapshotInputs(s),
  };
  s.measureJob = job;
  return job;
}

/** Land a success: stale jobs (superseded, edited, or new case) never write. */
export function completeMeasureJob(s: Session, job: MeasureJob, payload: Payload, measurement: Measurement): boolean {
  if (!isCurrentJob(s, job)) return false;
  s.payload = payload;
  s.measurement = measurement;
  job.state = "done";
  return true;
}

/** Land a failure: stale errors never navigate. */
export function failMeasureJob(s: Session, job: MeasureJob, error: string): boolean {
  if (s.measureJob !== job || job.seq !== s.measureSeq) return false;
  // An input edit after the failure started still discards the error: the
  // user is already fixing it, no point yanking them back.
  if (!inputsMatch(s, job)) return false;
  job.state = "error";
  job.error = error;
  return true;
}

/** Taps/coin/photo/new-case edits supersede any in-flight job and drop a
 *  landed result built from the old inputs. Payload is cleared so Say can
 *  never report stale numbers. */
export function invalidateMeasure(s: Session): void {
  s.measureSeq = (s.measureSeq ?? 0) + 1;
  s.measureJob = null;
  s.payload = null;
  s.measurement = null;
}
