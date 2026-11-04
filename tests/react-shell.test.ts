import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const exists = (path: string): boolean => existsSync(new URL(path, root));

test("React app exists with the full screen set", () => {
  const pkg = JSON.parse(read("react/package.json")) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.ok(pkg.dependencies?.react, "react dependency");
  assert.ok(pkg.dependencies?.["react-dom"], "react-dom dependency");
  assert.ok(pkg.scripts?.build?.includes("vite build"), "vite build script");

  for (const f of [
    "react/index.html", "react/vite.config.ts", "react/src/main.tsx", "react/src/App.tsx",
    "react/src/screens/Capture.tsx", "react/src/screens/Mark.tsx", "react/src/screens/Say.tsx",
    "react/src/screens/Numbers.tsx", "react/src/screens/Check.tsx", "react/src/screens/Report.tsx",
    "react/src/screens/Tabs.tsx", "react/public/sw.js", "react/public/manifest.webmanifest",
    "react/public/coin-model.js", "react/public/sam-worker.js", "react/public/voice-worker.js",
  ]) {
    assert.ok(exists(f), `${f} exists`);
  }

  const app = read("react/src/App.tsx");
  for (const screen of ["tHome", "tCases", "tSettings", "capture", "sReview", "sMark", "sSay", "sNum", "sCheck", "sReport"]) {
    assert.ok(app.includes(`"${screen}"`), `screen ${screen} in the React state machine`);
  }
  assert.ok(app.includes('id="stepLoading"'), "every screen change shows the forced step loader");
  assert.ok(app.includes("1000"), "step loader is scripted to a full second");
  assert.ok(app.includes("20 * 60 * 1000"), "long-lived app polls for worker updates");
  const mark = read("react/src/screens/Mark.tsx");
  assert.ok(mark.includes("taking too long to load"), "a stalled photo decode fails visible, never silent");
  assert.ok(mark.includes("came out black"), "an empty decode is reported, never shown black");
});

test("Capture has one primary action and camera-free paths", () => {
  const cap = read("react/src/screens/Capture.tsx");
  for (const id of ["shutter", "uploadBtn", "altEntry", "noCoin", "enableCam", "tipsBtn", "tipsGotIt", "tipsClose"]) {
    assert.ok(cap.includes(`id="${id}"`), `capture keeps #${id}`);
  }
  for (const copy of [
    "Tap to capture",
    "Percentages only - no millimetres",
    "Fit damage + coin in frame - you'll tap both next",
    "snapclaim.tipsSeen",
    "That frame came out black - hold steady and try again.",
    "Camera feed is blocked - close other camera apps, then retry.",
  ]) {
    assert.ok(cap.includes(copy), `capture copy: ${copy}`);
  }
  assert.ok(!cap.includes("Place a coin to unlock"), "no coin gate blocks the shutter");
  assert.ok(!cap.includes("CoinGate"), "live detection gate is gone");
});

test("Mark gates on crack selection; cloud-only, no model download", () => {
  const mark = read("react/src/screens/Mark.tsx");
  assert.ok(mark.includes("Select crack to continue."), "empty state names the required action");
  assert.ok(mark.includes("Cloud-only: SAM 3.1 API is the only outlining path"), "tap path is API-only");
  assert.ok(!mark.includes("Loading the on-device outlining model"), "no on-device loading state on the tap path");
  assert.ok(!mark.includes("Loading the coin model"), "no on-device loading state on the coin path");
  assert.ok(mark.includes("segmentCoinViaApi"), "coin tap is outlined via SAM like the crack");
  assert.ok(!mark.includes("estR"), "no guessed coin radius feeds the measurement");
  assert.ok(mark.includes("there is nothing outlined to measure"), "measure refuses an empty mask even if forced");
  assert.ok(!mark.includes("useEffect(() => () => { measureSeq.current++; }, [])"), "no unmount bump: measure navigates mid-run by design, and invalidating it drops every measurement after /v1/observe");
  assert.ok(mark.includes('histRef'), "undo tracks tap order across crack and coin");
  assert.ok(mark.includes('last === "coin"'), "undo pops the last tap first, including the coin");
});

test("Report is an official document with PDF and send options", () => {
  const rep = read("react/src/screens/Report.tsx");
  for (const id of ["pdfBtn", "shareBtn", "copyBtn", "emailBtn", "waBtn", "renderBtn", "annexImg", "docMeta"]) {
    assert.ok(rep.includes(`id="${id}"`), `report keeps #${id}`);
  }
  assert.ok(rep.includes("buildReportPdf"), "PDF is a real client-side download, not window.print");
  assert.ok(!rep.includes("window.print()"), "no print-dependent download path remains");
  assert.ok(rep.includes("wa.me"), "WhatsApp send option exists");
  assert.ok(rep.includes("mailto:"), "email send option exists");
  assert.ok(rep.includes("Ref {refNo}"), "report carries a reference number");
  assert.ok(rep.includes("New report for another damage"), "report offers a fresh claim for the next damage");
  assert.ok(rep.includes('onClick={() => go("tHome")}'), "Back to home returns to the home tab, not the camera");
  assert.ok(rep.includes("came back without the photo"), "a photo-less annexure fails loudly, never silent");
  assert.ok(rep.includes("Nothing to render yet"), "Generate fails loudly on an empty session, never silent");
  assert.ok(rep.includes('className="doctable"') && rep.includes('data-h="Status"'), "doc table reflows to stacked rows on narrow phones");
  assert.ok(rep.includes("AI-extended from your one line"), "the report labels AI-extended text honestly");
  assert.ok(rep.includes('id="locPhotoFig"'), "the report shows the location photo as its own figure");
  assert.ok(rep.includes("locationImg"), "the share link carries the location photo");
  assert.ok(rep.includes('id="linkBtn"'), "report offers a landlord share link");
  assert.ok(rep.includes('id="linkFallback"'), "blocked clipboards get a manual-copy field, never silence");
  assert.ok(rep.includes("{gateOk &&"), "share/export options appear only after Generate report succeeds");
  assert.ok(rep.includes("useState(!!s.annexUrl)"), "report state survives leaving and coming back (no second Generate, no duplicate case)");
  assert.ok(rep.includes("/lib/share"), "share link is built locally, nothing uploaded");
  const app = read("react/src/App.tsx");
  assert.ok(app.includes('"sShared"'), "a shared link opens the read-only report view");
  const shared = read("react/src/screens/Shared.tsx");
  assert.ok(shared.includes('id="annexImg"') && shared.includes('id="sharedPdfBtn"'), "shared view shows the figure and downloads a PDF");
});

test("React port keeps backend, worker and privacy contracts", () => {
  const all = [
    "react/src/App.tsx", "react/src/screens/Capture.tsx", "react/src/screens/Mark.tsx",
    "react/src/screens/Say.tsx", "react/src/screens/Numbers.tsx", "react/src/screens/Check.tsx",
    "react/src/screens/Report.tsx", "react/src/screens/Tabs.tsx",
    "react/src/lib/sam.ts", "react/src/lib/voice.ts", "react/src/lib/sample.ts",
  ].map(read).join("\n");
  for (const path of ["/v1/measure", "/v1/observe", "/v1/report", "/v1/skeptic", "/v1/crosscheck", "/v1/render", "/v1/transcribe", "/v1/segment", "/v1/health"]) {
    assert.ok(all.includes(path), `React port calls ${path}`);
  }
  assert.ok(all.includes("sam-worker.js"), "SlimSAM worker reused");
  assert.ok(all.includes("voice-worker.js"), "Whisper worker reused");
  assert.ok(all.includes("Server transcriber first"), "voice tries the server transcriber before on-device");
  assert.ok(!all.includes('innerHTML ='), "no raw HTML injection in the React port");

  const sw = read("react/public/sw.js");
  assert.ok(/snapclaim-react-v\d+/.test(sw), "versioned cache");
  assert.ok(sw.includes("SKIP_WAITING"), "updates wait for Reload");
  assert.ok(sw.includes("/v1/"), "API bypass is explicit");

  const check = read("react/src/screens/Check.tsx");
  assert.ok(check.includes("Run the measurement first"), "React skeptic guards a missing measurement");
  assert.ok(check.includes("Evidence gate failed") && check.includes("retried"), "React retries gate failures once");
  assert.ok(check.includes("console.error"), "React logs backend errors with status");
  assert.ok(check.includes("Skeptic unavailable") && check.includes("Cross-check unavailable"), "React names 4xx states");
  assert.ok(check.includes('id="xPhotoCard"') && check.includes('id="xChip"'), "React shows both cross-check outlines over the photo");
  const num = read("react/src/screens/Numbers.tsx");
  assert.ok(num.includes('id="skipChecks"'), "Numbers offers skipping the double-check");
  const say = read("react/src/screens/Say.tsx");
  assert.ok(!say.includes('id="aiDescribeBtn"'), "Say stays manual - no auto-fill button");
  assert.ok(say.includes("/v1/describe"), "the manual line is AI-extended on the way to the report");
  assert.ok(say.includes("extendedTranscript"), "the extension is stored separately from the verbatim line");
  assert.ok(say.includes('id="locAddBtn"') && say.includes("locationPhoto"), "Say captures an optional location photo");
  assert.ok(say.includes("not measured"), "location photo is labeled unmeasured");
  const tabs = read("react/src/screens/Tabs.tsx");
  assert.ok(tabs.includes('id="metaKeyInput"') && tabs.includes('id="byokSave"') && tabs.includes('id="byokClear"'), "settings offers device-only BYOK fields");
  assert.ok(tabs.includes("never stored server-side"), "BYOK copy states the key handling honestly");
  const css = read("react/src/styles.css");
  assert.ok(css.includes(".samplecell .imgph") && css.includes("aspect-ratio:4/3"), "sample thumbs reserve their box so the first tap cannot miss on reflow");
  for (const sel of [".field-input{", ".text-input{", 'dialog#caseDlg input[type="text"]']) {
    const i = css.indexOf(sel);
    assert.ok(i >= 0, `${sel} styled`);
    assert.ok(css.slice(i, i + 400).includes("font-size:16px"), `${sel} stays 16px so iOS never focus-zooms`);
  }
  assert.ok(css.includes("@media (max-width:380px)"), "small phones get tighter type and tables");
  assert.ok(css.includes(".navrow button") && css.includes("min-height:44px"), "back buttons meet the 44px touch target");
  assert.ok(check.includes("unavailable in mock mode"), "React surfaces the segment-mock reason");
  assert.ok(read("react/src/screens/Tabs.tsx").includes("Mock backend: every measurement would be invented"), "Settings names a mock backend on sight");
  assert.ok(check.includes("minReferenceConfidence"), "React skeptic sends the same measure inputs as report");
  assert.ok(!check.includes("...(s.payload ?? {})"), "React skeptic no longer sprays the overlay at the backend");
  const api = read("react/src/lib/api.ts");
  assert.ok(api.includes("backendError"), "shared status + details error helper");
  const mark = read("react/src/screens/Mark.tsx");
  assert.ok(mark.includes("coinManualPt"), "React keeps a manual coin correction like the PWA");
  assert.ok(mark.includes("manualCoinRadius"), "React manual ring shares the measured radius");
  assert.ok(mark.includes("Tap coin to correct"), "React offers the coin correction tap");
  assert.ok(mark.includes("coinTaped"), "React offers the taped-coin lenient outline");
  assert.ok(mark.includes("2.5"), "React tape halo uses the lenient outline margin");
  const session = read("react/src/lib/session.ts");
  assert.ok(session.includes("coinManualPt") && session.includes("coinTaped"), "session carries the correction");
  for (const w of ["react/public/sam-worker.js", "react/public/voice-worker.js"]) {
    assert.ok(read(w).includes('tf.env.logLevel = "error"'), `${w} quiets ONNX Runtime warnings`);
  }
  for (const w of ["react/public/sam-worker.js", "pwa/sam-worker.js"]) {
    assert.ok(read(w).includes("photoId: progressPhotoId"), `${w} tags progress with the photo so stale downloads never paint the bar`);
  }
  assert.ok(mark.includes("That photo could not be read"), "unreadable photo fails closed instead of keeping a stale mask");
  assert.ok(mark.includes("there is nothing outlined to measure"), "measure refuses an empty mask even if the button is forced");
  assert.ok(mark.includes('role="listbox"') && mark.includes('id="coinKind"'), "coin size uses a custom listbox, not the native select");
  assert.ok(mark.includes("aria-activedescendant") && mark.includes("aria-selected"), "coin listbox exposes selection to assistive tech");
  assert.ok(read("react/src/styles.css").includes('html[data-theme="dark"] .coindrop-btn'), "custom dropdown is themed for dark mode");
  assert.ok(mark.includes("Mock backend refused"), "measure refuses a mock backend instead of inventing numbers");

  const html = read("react/index.html");
  assert.ok(html.includes("Content-Security-Policy"), "CSP kept");
  for (const host of ["https://cdn.jsdelivr.net", "https://huggingface.co"]) {
    assert.ok(html.includes(host), `React CSP connect-src allows the on-device model CDN (${host})`);
  }
  assert.ok(!html.includes("user-scalable=no"), "pinch zoom allowed");
  assert.ok(html.includes('src="./theme.js"'), "pre-paint theme kept");
  assert.ok(html.includes('src="./coin-model.js"'), "coin model global kept");
});

test("React store is the vanilla store contract", () => {
  const store = read("react/src/lib/store.ts");
  assert.ok(store.includes('CASES_KEY = "snapclaim.cases.v1"'), "same localStorage key: existing cases survive the switch");
  assert.ok(store.includes('SETTINGS_KEY = "snapclaim.settings.v1"'), "same settings key");
  assert.ok(store.includes("photoDropped"), "quota photo-drop kept");
  assert.ok(store.includes("crackWidthMm"), "saved cases keep the width so the PDF survives a reload");
});

test("Saved cases offer a PDF, not just JSON", () => {
  const tabs = read("react/src/screens/Tabs.tsx");
  assert.ok(tabs.includes('id="dlgPdf"'), "case dialog has a Download PDF button");
  assert.ok(tabs.includes("buildReportPdf"), "saved-case PDF is built offline from the stored numbers and photos");
  assert.ok(tabs.includes("Export JSON"), "raw-data button is labeled JSON so nobody expects a report from it");
});
