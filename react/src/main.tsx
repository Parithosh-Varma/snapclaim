import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No StrictMode: its dev double-effect would acquire/release the camera and
// speech/mic streams twice. Production behavior is identical either way.
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
