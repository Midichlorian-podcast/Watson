import { useEffect, useState } from "react";

/** Mobilní breakpoint dle prototypu: vw < 880 (ř. 3009 isMobile). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 879px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 879px)");
    const update = () => setMobile(mq.matches);
    mq.addEventListener("change", update);
    // fallback pro emulovaný resize (ne vždy vystřelí MQ change)
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return mobile;
}
