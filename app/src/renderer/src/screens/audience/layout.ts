import type { CSSProperties } from "react";
import type { AudienceRotation } from "@shared/audience";

/**
 * Where the audience picture sits for a rotation. A quarter turn swaps the width and height, so the box is the screen's height wide and
 * its width tall, and is then moved back on to the screen. Rotation is set by the performer for a screen mounted sideways.
 */
export function rotationStyle(rotation: AudienceRotation): CSSProperties {
  if (rotation === 90)
    return {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100vh",
      height: "100vw",
      transformOrigin: "top left",
      transform: "translateX(100vw) rotate(90deg)",
    };
  if (rotation === 270)
    return {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100vh",
      height: "100vw",
      transformOrigin: "top left",
      transform: "translateY(100vh) rotate(270deg)",
    };
  return { position: "absolute", inset: 0, transform: rotation === 180 ? "rotate(180deg)" : undefined };
}
