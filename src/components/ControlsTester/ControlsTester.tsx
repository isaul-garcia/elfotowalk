import React, { useMemo, useState } from "react";
import { useKnobSerial } from "../../hooks/useKnobSerial";

type ButtonState = {
  encoder: number;
  btn2: number;
  btn3: number;
  joyBtn: number;
};

export default function ControlsTester() {
  const [log, setLog] = useState<string[]>([]);
  const [buttons, setButtons] = useState<ButtonState>({
    encoder: 0,
    btn2: 0,
    btn3: 0,
    joyBtn: 0,
  });
  const [joy, setJoy] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const push = (msg: string) =>
    setLog((prev) => {
      const next = [msg, ...prev];
      return next.slice(0, 40);
    });

  const {
    connect,
    disconnect,
    isConnected,
    error,
    isSupported,
  } = useKnobSerial({
    onRotate: (d) => push(`ROT ${d > 0 ? "+1" : "-1"}`),
    onBtn: () => {
      setButtons((b) => ({ ...b, encoder: b.encoder + 1 }));
      push("BTN");
    },
    onBtn2: () => {
      setButtons((b) => ({ ...b, btn2: b.btn2 + 1 }));
      push("BTN2");
    },
    onBtn3: () => {
      setButtons((b) => ({ ...b, btn3: b.btn3 + 1 }));
      push("BTN3");
    },
    onJoyBtn: () => {
      setButtons((b) => ({ ...b, joyBtn: b.joyBtn + 1 }));
      push("JOYBTN");
    },
    onJoy: (x, y) => {
      setJoy({ x, y });
      push(`JOY ${x},${y}`);
    },
  });

  const status = useMemo(() => {
    if (!isSupported) return "Web Serial not available (Chrome/Edge only).";
    if (error) return `Error: ${error}`;
    return isConnected ? "Connected" : "Disconnected";
  }, [isConnected, isSupported, error]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.row}>
          <button
            type="button"
            onClick={isConnected ? disconnect : connect}
            disabled={!isSupported}
            style={styles.button}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </button>
          <span style={styles.status}>{status}</span>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Buttons</div>
          <div style={styles.chips}>
            <Chip label="Encoder" value={buttons.encoder} />
            <Chip label="BTN2" value={buttons.btn2} />
            <Chip label="BTN3" value={buttons.btn3} />
            <Chip label="JOYBTN" value={buttons.joyBtn} />
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Joystick</div>
          <div style={styles.row}>
            <div style={styles.coord}>
              X: <strong>{joy.x}</strong>
            </div>
            <div style={styles.coord}>
              Y: <strong>{joy.y}</strong>
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Recent events</div>
          <div style={styles.log}>
            {log.map((entry, idx) => (
              <div key={`${entry}-${idx}`} style={styles.logLine}>
                {entry}
              </div>
            ))}
            {log.length === 0 && <div style={styles.muted}>Waiting for input…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span style={styles.chip}>
      {label}: <strong>{value}</strong>
    </span>
  );
}

const styles: { [k: string]: React.CSSProperties } = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f172a",
    color: "#e2e8f0",
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    padding: "24px",
  },
  card: {
    width: "100%",
    maxWidth: "560px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "14px",
    padding: "18px 18px 8px",
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  button: {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.25)",
    background: "linear-gradient(135deg, #38bdf8, #6366f1)",
    color: "#0b1220",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
    letterSpacing: "0.01em",
  },
  status: { opacity: 0.85, fontSize: "0.95rem" },
  section: { marginTop: "16px" },
  sectionTitle: {
    fontWeight: 700,
    marginBottom: "8px",
    letterSpacing: "0.01em",
    color: "#cbd5f5",
  },
  chips: { display: "flex", gap: "8px", flexWrap: "wrap" },
  chip: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "0.95rem",
  },
  coord: { minWidth: "80px" },
  log: {
    height: "180px",
    overflow: "auto",
    background: "rgba(0,0,0,0.2)",
    borderRadius: "10px",
    padding: "10px",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  logLine: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.95rem",
    padding: "2px 0",
  },
  muted: { opacity: 0.65 },
};
