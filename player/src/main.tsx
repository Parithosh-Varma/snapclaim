import React from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { TapePlayer } from "./TapePlayer";

const mounts = document.querySelectorAll<HTMLElement>("[data-remotion-player]");
mounts.forEach((el) => {
  const src = el.dataset.src ?? "";
  const label = el.dataset.label ?? "SNAPCLAIM";
  const duration = Number(el.dataset.duration ?? "900");
  if (!src) return;
  createRoot(el).render(
    <React.StrictMode>
      <Player
        component={TapePlayer}
        inputProps={{ src, label }}
        durationInFrames={duration}
        fps={30}
        compositionWidth={1080}
        compositionHeight={1920}
        acknowledgeRemotionLicense
        autoPlay
        muted
        loop
        controls
        clickToPlay={false}
        style={{ width: "100%", aspectRatio: "9 / 16", display: "block" }}
      />
    </React.StrictMode>,
  );
});
