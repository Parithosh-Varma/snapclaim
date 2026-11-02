import React from "react";
import { AbsoluteFill, Video } from "remotion";

export const TapePlayer: React.FC<{ src: string; label: string }> = ({
  src,
  label,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video src={src} style={{ width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          display: "flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: "rgba(11, 37, 87, 0.92)",
          color: "#fff",
          fontFamily:
            "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif",
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "0.08em",
          padding: "14px 22px",
          borderRadius: 999,
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: "#f2b007",
          }}
        />
        {label}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 10,
          background:
            "repeating-linear-gradient(90deg, #f2b007 0 14px, transparent 14px 28px)",
          opacity: 0.9,
        }}
      />
    </AbsoluteFill>
  );
};
