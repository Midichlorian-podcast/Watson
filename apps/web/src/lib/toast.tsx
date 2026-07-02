import { useEffect, useState } from "react";

/**
 * Sdílený akční toast (flowToast prototypu, ř. 1082–1084): navy pilulka dole uprostřed
 * s brass tečkou, ~2,8 s. Event-based, ať jde volat i mimo React strom (lib/tasks.ts).
 */
const EVT = "watson:toast";

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent(EVT, { detail: message }));
}

export function ActionToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const h = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 2800);
    };
    window.addEventListener(EVT, h);
    return () => {
      window.removeEventListener(EVT, h);
      clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div
      className="-translate-x-1/2 fixed bottom-6 left-1/2 z-[60] flex items-center font-display font-semibold"
      style={{
        gap: 8,
        background: "var(--w-navy)",
        color: "#fff",
        fontSize: 12.5,
        padding: "9px 15px",
        borderRadius: 999,
        boxShadow: "var(--w-shadow)",
        animation: "wPop .18s ease",
      }}
    >
      <span className="shrink-0 rounded-full" style={{ width: 6, height: 6, background: "var(--w-brass)" }} />
      {msg}
    </div>
  );
}
