export interface CoinCandidate {
  /** Centre, in image pixels. */
  x: number;
  y: number;
  /** Radius, in image pixels. */
  r: number;
  /** Share of the circle's outline backed by an edge pointing at the centre. */
  coverage: number;
}

export function findCoins(image: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }): CoinCandidate[];
