/**
 * SnapClaim CLI - the app without the interface.
 *
 *   npm run cli -- health
 *   npm run cli -- claim --image damage.jpg --tap 420,310,crack --say "crack above the window"
 *   npm run cli -- claim --request claim.json --out report.json --svg annexure.svg
 *
 * Zero dependencies: it posts to the same /v1 routes the app uses, so a
 * self-hosted or public backend behaves identically. Machine output goes to
 * stdout (or --out); the human summary goes to stderr.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const DEFAULT_BACKEND = "http://127.0.0.1:8787";

const USAGE = `snapclaim - measured damage reports without the UI

usage:
  snapclaim health [--backend URL]
  snapclaim claim  [flags]

claim inputs (one of):
  --request FILE            full /v1/claim JSON body, used as-is
  --image FILE              local photo -> data URL (PNG, JPEG or WebP)
  --image-url URL           photo already hosted (https://) or a data URL

claim taps (with --image / --image-url):
  --tap X,Y,LABEL           repeatable; label: crack | stain | peel | dent
  --coin X,Y,KNOWNMM        coin tap + its real diameter in mm (for absolute cm²/mm)
  --width N --height N      photo pixels; auto-detected for --image

claim options:
  --say TEXT                the one spoken line (also --transcript, --say-file)
  --say-audio FILE          WAV clip: /v1/transcribe first, then claim (live only)
  --no-render               skip the SVG annexure
  --no-photo                do not embed the local photo in the annexure
  --out FILE                write the whole reply here (default: stdout)
  --svg FILE                write the annexure SVG here
  --meta-key KEY            bring-your-own Meta key (or META_API_KEY env)
  --baseten-key KEY         bring-your-own Baseten key (or BASETEN_API_KEY env)
  --bearer TOKEN            Authorization header (REQUIRE_BILLING_AUTH)
  --backend URL             default ${DEFAULT_BACKEND} (or SNAPCLAIM_BACKEND)
  --dry-run                 print the request body, send nothing
  --quiet                   suppress the human summary on stderr

env: SNAPCLAIM_BACKEND, META_API_KEY, BASETEN_API_KEY

notes:
  - masks[] (COCO RLE) work in mock and live mode and cost $0.
  - photo segmentation is live-only: run the backend with MOCK_MODE=0 and
    META_API_KEY; SAM bills about $0.0025 per image (one call per group of
    damage taps + one for the coin).
  - JSON bodies are capped at 1 MB, so keep local photos small or use
    --image-url.
  - every number is measured and gated server-side; this CLI never invents one.
`;

export interface Parsed {
  command: string;
  values: Map<string, string[]>;
  flags: Set<string>;
}

class CliError extends Error {}

export function parseArgs(argv: string[]): Parsed {
  const [command = "help", ...rest] = argv;
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const queue = [...rest];
  const push = (name: string, value: string): void => {
    const list = values.get(name) ?? [];
    list.push(value);
    values.set(name, list);
  };
  while (queue.length > 0) {
    const token = queue.shift() as string;
    if (!token.startsWith("--")) throw new CliError(`unexpected argument: ${token} (run "snapclaim help")`);
    const name = token.slice(2);
    const eq = name.indexOf("=");
    if (eq >= 0) {
      push(name.slice(0, eq), name.slice(eq + 1));
      continue;
    }
    const next = queue[0];
    if (next !== undefined && !next.startsWith("--")) {
      queue.shift();
      push(name, next);
    } else {
      flags.add(name);
    }
  }
  return { command, values, flags };
}

function one(parsed: Parsed, ...names: string[]): string | undefined {
  for (const name of names) {
    const list = parsed.values.get(name);
    if (list !== undefined && list.length > 0) return list[list.length - 1];
  }
  return undefined;
}

function all(parsed: Parsed, name: string): string[] {
  return parsed.values.get(name) ?? [];
}

function backendUrl(parsed: Parsed): string {
  const raw = one(parsed, "backend") ?? process.env.SNAPCLAIM_BACKEND ?? DEFAULT_BACKEND;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`--backend is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new CliError("--backend must be http:// or https://");
  return raw.replace(/\/+$/, "");
}

export function headers(parsed: Parsed): Record<string, string> {
  const out: Record<string, string> = { "content-type": "application/json" };
  const meta = one(parsed, "meta-key") ?? process.env.META_API_KEY;
  const baseten = one(parsed, "baseten-key") ?? process.env.BASETEN_API_KEY;
  if (meta !== undefined && meta !== "") out["x-meta-key"] = meta;
  if (baseten !== undefined && baseten !== "") out["x-baseten-key"] = baseten;
  const bearer = one(parsed, "bearer");
  if (bearer !== undefined && bearer !== "") out.authorization = `Bearer ${bearer}`;
  return out;
}

type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface LocalImage {
  dataUrl: string;
  mime: ImageMime;
  width: number;
  height: number;
  bytes: number;
}

function sniffMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

/** PNG: IHDR is the first chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** JPEG: walk markers to the first SOF (start of frame) segment. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1] as number;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (length < 7) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // height at +5, width at +7 (after the 2-byte length and 1-byte precision)
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/** WebP: VP8X has 24-bit canvas size; VP8 / VP8L encode the frame size. */
function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === "VP8X") {
    const w = 1 + ((bytes[24] as number) | ((bytes[25] as number) << 8) | ((bytes[26] as number) << 16));
    const h = 1 + ((bytes[27] as number) | ((bytes[28] as number) << 8) | ((bytes[29] as number) << 16));
    return { width: w, height: h };
  }
  if (chunk === "VP8L") {
    // 14 bits width-1, then 14 bits height-1, little-endian after the signature byte.
    const b = bytes[21] as number, c = bytes[22] as number, d = bytes[23] as number, e = bytes[24] as number;
    return { width: 1 + (b | ((c & 0x3f) << 8)), height: 1 + ((c >> 6) | (d << 2) | ((e & 0x0f) << 10)) };
  }
  if (chunk === "VP8 ") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return null;
}

export function loadImage(path: string): LocalImage {
  const bytes = readFileSync(path);
  const mime = sniffMime(bytes) ?? (extname(path).toLowerCase() === ".png" ? "image/png" : extname(path).toLowerCase() === ".webp" ? "image/webp" : "image/jpeg");
  const size = mime === "image/png" ? pngSize(bytes) : mime === "image/jpeg" ? jpegSize(bytes) : webpSize(bytes);
  if (size === null || size.width <= 0 || size.height <= 0) {
    throw new CliError(`could not read the pixel size of ${path} - pass --width and --height`);
  }
  return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, mime, ...size, bytes: bytes.length };
}

export function parseTap(raw: string): { x: number; y: number; label: string } {
  const [x, y, label, ...rest] = raw.split(",").map((part) => part.trim());
  if (x === undefined || y === undefined || label === undefined || rest.length > 0) {
    throw new CliError(`--tap needs X,Y,LABEL, got "${raw}"`);
  }
  const xN = Number(x);
  const yN = Number(y);
  if (!Number.isFinite(xN) || !Number.isFinite(yN)) throw new CliError(`--tap coordinates must be numbers, got "${raw}"`);
  if (label === "") throw new CliError(`--tap needs a label: crack | stain | peel | dent, got "${raw}"`);
  return { x: xN, y: yN, label };
}

export function parseCoin(raw: string): { x: number; y: number; knownMm: number } {
  const [x, y, mm, ...rest] = raw.split(",").map((part) => part.trim());
  const xN = Number(x);
  const yN = Number(y);
  const mmN = Number(mm);
  if (rest.length > 0 || !Number.isFinite(xN) || !Number.isFinite(yN) || !Number.isFinite(mmN)) {
    throw new CliError(`--coin needs X,Y,KNOWNMM, got "${raw}"`);
  }
  return { x: xN, y: yN, knownMm: mmN };
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new CliError(`cannot read ${path}`);
  }
}

function claimBody(parsed: Parsed): Record<string, unknown> {
  const requestPath = one(parsed, "request");
  if (requestPath !== undefined) {
    try {
      return JSON.parse(readFileSync(requestPath, "utf8")) as Record<string, unknown>;
    } catch (error) {
      throw new CliError(`cannot read a JSON body from ${requestPath}: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }

  const body: Record<string, unknown> = {};
  const imagePath = one(parsed, "image");
  const imageUrl = one(parsed, "image-url");
  if (imagePath !== undefined && imageUrl !== undefined) throw new CliError("use either --image or --image-url, not both");

  let image: LocalImage | undefined;
  if (imagePath !== undefined) image = loadImage(imagePath);
  if (image !== undefined) {
    body.imageUrl = image.dataUrl;
    body.width = image.width;
    body.height = image.height;
    // The annexure embeds only inline PNG/JPEG and only up to its 200k budget.
    const embed = !parsed.flags.has("no-photo") && image.dataUrl.length <= 200_000 &&
      (image.mime === "image/png" || image.mime === "image/jpeg");
    if (embed) body.photoHref = image.dataUrl;
    if (image.dataUrl.length > 900_000) {
      warn(`${imagePath} is ${Math.round(image.bytes / 1024)} KB - a 1 MB JSON cap may reject it; host it and use --image-url`);
    }
  } else if (imageUrl !== undefined) {
    body.imageUrl = imageUrl;
    const width = one(parsed, "width");
    const height = one(parsed, "height");
    if (width === undefined || height === undefined) throw new CliError("--image-url needs --width and --height (the photo's pixel size)");
    body.width = Number(width);
    body.height = Number(height);
  } else {
    throw new CliError("claim needs --request FILE, or --image/--image-url plus at least one --tap");
  }

  const taps = all(parsed, "tap").map(parseTap);
  if (taps.length === 0) throw new CliError("add at least one --tap X,Y,LABEL (or use --request FILE for masks[] claims)");
  body.damage = taps;
  const coin = one(parsed, "coin");
  if (coin !== undefined) body.coin = parseCoin(coin);

  const say = one(parsed, "say", "transcript");
  const sayFile = one(parsed, "say-file");
  const sayAudio = one(parsed, "say-audio");
  const spoken = [say, sayFile, sayAudio].filter((value) => value !== undefined).length;
  if (spoken > 1) throw new CliError("use only one of --say, --say-file, --say-audio");
  if (say !== undefined) body.transcript = say;
  else if (sayFile !== undefined) body.transcript = readText(sayFile);

  if (parsed.flags.has("no-render")) body.render = false;
  return body;
}

function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

function summary(reply: Record<string, unknown>, parsed: Parsed): void {
  if (parsed.flags.has("quiet")) return;
  const result = reply.result as {
    claimId?: string;
    measurement?: { mode?: string; provenance?: string; findings?: { label: string; percent: number; crackLengthMm: number | null; areaCm2: number | null; severity: string }[] };
    findings?: { statement: string }[];
    gate?: { ok?: boolean };
    segmentation?: { records: number; dropped: number; taps: number };
  } | undefined;
  if (result === undefined) return;
  const findings = result.measurement?.findings ?? [];
  process.stderr.write(
    `claim ${result.claimId ?? "-"} · ${result.measurement?.mode ?? "?"} · ${result.measurement?.provenance ?? "?"} · ` +
      `${findings.length} finding${findings.length === 1 ? "" : "s"} · gate ${result.gate?.ok ? "ok" : "FAILED"}\n`,
  );
  if (result.segmentation !== undefined) {
    process.stderr.write(
      `segmented ${result.segmentation.taps} tap${result.segmentation.taps === 1 ? "" : "s"} into ${result.segmentation.records} record${result.segmentation.records === 1 ? "" : "s"}` +
        (result.segmentation.dropped > 0 ? ` (${result.segmentation.dropped} wall-sized record${result.segmentation.dropped === 1 ? "" : "s"} dropped)` : "") +
        "\n",
    );
  }
  for (const finding of findings) {
    const parts = [`${finding.label}: ${finding.percent}%`];
    if (finding.crackLengthMm !== null) parts.push(`${finding.crackLengthMm} mm`);
    if (finding.areaCm2 !== null) parts.push(`${finding.areaCm2} cm2`);
    parts.push(finding.severity);
    process.stderr.write(`  ${parts.join(" · ")}\n`);
  }
  for (const draft of result.findings ?? []) process.stderr.write(`  "${draft.statement}"\n`);
}

async function call(backend: string, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${backend}${path}`, init);
  } catch (error) {
    throw new CliError(`backend unreachable at ${backend}: ${error instanceof Error ? error.message : "network error"}`);
  }
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new CliError(`backend returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok || body.ok === false) {
    const details = Array.isArray(body.details) ? `\n  - ${(body.details as unknown[]).map(String).join("\n  - ")}` : "";
    throw new CliError(`${body.error ?? `HTTP ${res.status}`}${details}`);
  }
  return body;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.command === "version") {
    process.stdout.write("snapclaim CLI\n");
    return;
  }
  if (parsed.flags.has("help")) {
    process.stdout.write(USAGE);
    return;
  }

  const backend = backendUrl(parsed);

  if (parsed.command === "health") {
    const health = await call(backend, "/v1/health", { headers: headers(parsed) });
    const mode = (health as { mode?: unknown }).mode;
    process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
    if (mode !== "live") {
      warn(`backend mode is ${String(mode)} - photo segmentation needs MOCK_MODE=0 + META_API_KEY; masks[] claims work in any mode`);
    }
    return;
  }

  if (parsed.command !== "claim") throw new CliError(`unknown command "${parsed.command}" (try: health, claim)`);

  const body = claimBody(parsed);
  const audioPath = one(parsed, "say-audio");
  if (audioPath !== undefined && parsed.flags.has("dry-run")) {
    throw new CliError("--dry-run cannot transcribe audio: it sends nothing");
  }
  if (audioPath !== undefined) {
    const bytes = readFileSync(audioPath);
    if (bytes.length > 4_000_000) throw new CliError(`${audioPath} is over 4 MB - Muse accepts a 10 second clip, not a call recording`);
    const transcribed = await call(backend, "/v1/transcribe", {
      method: "POST",
      headers: headers(parsed),
      body: JSON.stringify({ audioBase64: bytes.toString("base64") }),
    });
    const transcript = (transcribed.result as { transcript?: unknown } | undefined)?.transcript;
    if (typeof transcript !== "string" || transcript.trim() === "") throw new CliError("transcription returned no words");
    body.transcript = transcript;
    if (!parsed.flags.has("quiet")) process.stderr.write(`heard: "${transcript}"\n`);
  }
  if (parsed.flags.has("dry-run")) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }

  const reply = await call(backend, "/v1/claim", {
    method: "POST",
    headers: headers(parsed),
    body: JSON.stringify(body),
  });

  const out = one(parsed, "out");
  const text = `${JSON.stringify(reply, null, 2)}\n`;
  if (out !== undefined) {
    writeFileSync(out, text);
  } else {
    process.stdout.write(text);
  }
  const svgPath = one(parsed, "svg");
  const svg = (reply.result as { svg?: unknown } | undefined)?.svg;
  if (svgPath !== undefined) {
    if (typeof svg === "string") writeFileSync(svgPath, svg);
    else warn("no SVG in the reply (render was off?) - nothing written to --svg");
  }
  summary(reply, parsed);
  if (out !== undefined && !parsed.flags.has("quiet")) {
    process.stderr.write(`saved ${out}${svgPath !== undefined && typeof svg === "string" ? ` and ${svgPath}` : ""}\n`);
  }
}

const invokedAsCli = process.argv[1] !== undefined && process.argv[1].endsWith("snapclaim.ts");

if (invokedAsCli) {
  main().catch((error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
