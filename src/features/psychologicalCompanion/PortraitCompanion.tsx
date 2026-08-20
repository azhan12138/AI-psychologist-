import { useEffect, useState } from "react";

import styles from "@/styles/psychologicalCompanionPrototype.module.css";

export type MouthCue = "rest" | "a" | "o";
export type PortraitPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing"
  | "reviewing"
  | "thinking"
  | "speaking";

type Props = {
  mouthCue: MouthCue;
  phase: PortraitPhase;
  shifted?: boolean;
};

const PORTRAIT =
  "/companion-assets/companion-default-neutral-v2.png";

export default function PortraitCompanion({
  mouthCue,
  phase,
  shifted = false,
}: Props) {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    setBlinking(false);
    let blinkTimer = 0;
    let reopenTimer = 0;
    let doubleBlinkTimer = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const delay =
        phase === "speaking"
          ? 2800 + Math.random() * 2200
          : 3800 + Math.random() * 2800;
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        reopenTimer = window.setTimeout(() => {
          setBlinking(false);
          if (Math.random() < 0.14) {
            doubleBlinkTimer = window.setTimeout(() => {
              setBlinking(true);
              reopenTimer = window.setTimeout(() => {
                setBlinking(false);
                schedule();
              }, 105);
            }, 95);
          } else {
            schedule();
          }
        }, 125);
      }, delay);
    };
    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(blinkTimer);
      window.clearTimeout(reopenTimer);
      window.clearTimeout(doubleBlinkTimer);
    };
  }, [phase]);

  return (
    <div
      className={`${styles.portraitMotion} ${
        shifted ? styles.portraitDrawerOpen : ""
      } ${
        phase === "recording"
          ? styles.portraitListening
          : phase === "thinking"
            ? styles.portraitThinking
            : phase === "speaking"
              ? styles.portraitSpeaking
              : ""
      }`}>
      <img
        src={PORTRAIT}
        alt="心理陪伴数字人半身形象"
        className={styles.portraitFrame}
        draggable={false}
      />
      <span
        aria-hidden="true"
        className={`${styles.portraitLocalPatch} ${
          styles.portraitBlinkPatch
        } ${styles.portraitBlinkLeft} ${
          blinking ? styles.portraitLocalPatchActive : ""
        }`}
      />
      <span
        aria-hidden="true"
        className={`${styles.portraitLocalPatch} ${
          styles.portraitBlinkPatch
        } ${styles.portraitBlinkRight} ${
          blinking ? styles.portraitLocalPatchActive : ""
        }`}
      />
      <span
        aria-hidden="true"
        className={`${styles.portraitLocalPatch} ${
          styles.portraitMouthPatchA
        } ${mouthCue === "a" ? styles.portraitLocalPatchActive : ""}`}
      />
      <span
        aria-hidden="true"
        className={`${styles.portraitLocalPatch} ${
          styles.portraitMouthPatchO
        } ${mouthCue === "o" ? styles.portraitLocalPatchActive : ""}`}
      />
    </div>
  );
}
