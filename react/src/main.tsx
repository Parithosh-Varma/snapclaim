import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./onboarding.css";

// No StrictMode: its dev double-effect would acquire/release the camera and
// speech/mic streams twice. Production behavior is identical either way.
//
// Production proof PDFs (served from react/public/reports as /reports):
// - /reports/snapclaim-SC-D8ECE64B.pdf
// - /reports/Case Study Comparative Measurement of a Terrace-Slab Crack.pdf
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
