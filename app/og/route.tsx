/**
 * /og — dynamic OpenGraph image generator.
 * Returns a 1200×630 PNG-equivalent SVG used for social previews.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(135deg,#06060a 0%, #13131a 60%, #1a1a23 100%)",
          color: "#fafaf7",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: "#76766f" }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, background: "#8da4ff" }} />
          MindeesAI
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <p style={{ fontSize: 80, lineHeight: 1.02, letterSpacing: -2, margin: 0 }}>
            A native, self-training
            <br />
            open-source AI.
          </p>
          <p style={{ fontSize: 28, color: "#b8b8b0", margin: 0, maxWidth: 880 }}>
            Trains itself every five minutes — on its own conversations, with its own weights.
          </p>
        </div>
      </div>
    ),
    { ...size },
  );
}
