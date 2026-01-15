import React from "react";

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable?: WritableStream<Uint8Array> | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  addEventListener?: (type: string, cb: (...args: any[]) => void) => void;
  removeEventListener?: (type: string, cb: (...args: any[]) => void) => void;
};

type NavigatorWithSerial = Navigator & {
  serial?: {
    requestPort: () => Promise<SerialPortLike>;
    getPorts?: () => Promise<SerialPortLike[]>;
  };
};

type Handlers = {
  onRotate?: (delta: number) => void;
  onBtn?: () => void;
  onBtn2?: () => void;
  onBtn3?: () => void;
  onBtn4?: () => void;
  onJoy?: (x: number, y: number) => void;
  onJoyBtn?: () => void;
};

const BAUD_RATE = 115200;

const hasSerial = () =>
  typeof navigator !== "undefined" &&
  typeof (navigator as NavigatorWithSerial).serial !== "undefined";

const makeLineStream = (readable: ReadableStream<Uint8Array>) => {
  let buffer = "";
  return readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          buffer += chunk;
          const lines = buffer.split(/[\r\n]+/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) controller.enqueue(trimmed);
          }
        },
        flush(controller) {
          const trimmed = buffer.trim();
          if (trimmed) controller.enqueue(trimmed);
        },
      })
    );
};

export function useKnobSerial({
  onRotate,
  onBtn,
  onBtn2,
  onBtn3,
  onBtn4,
  onJoy,
  onJoyBtn,
}: Handlers = {}) {
  const [angle, setAngle] = React.useState(0);
  const [isConnected, setIsConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const portRef = React.useRef<SerialPortLike | null>(null);
  const readerRef =
    React.useRef<ReadableStreamDefaultReader<string> | null>(null);
  const handlersRef = React.useRef<Handlers>({
    onRotate,
    onBtn,
    onBtn2,
    onBtn3,
    onBtn4,
    onJoy,
    onJoyBtn,
  });

  const supportsSerial = React.useMemo(hasSerial, []);

  React.useEffect(() => {
    handlersRef.current = { onRotate, onBtn, onBtn2, onBtn3, onBtn4, onJoy, onJoyBtn };
  }, [onRotate, onBtn, onBtn2, onBtn3, onBtn4, onJoy, onJoyBtn]);

  const cleanupReader = React.useCallback(async () => {
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch {
        // ignore
      }
      try {
        readerRef.current.releaseLock();
      } catch {
        // ignore
      }
      readerRef.current = null;
    }
  }, []);

  const disconnect = React.useCallback(async () => {
    await cleanupReader();

    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch {
        // ignore close errors; port may already be gone
      }
      portRef.current = null;
    }

    setIsConnected(false);
  }, [cleanupReader]);

  const handleLine = React.useCallback(
    (line: string) => {
      const { onRotate, onBtn, onBtn2, onBtn3, onBtn4, onJoy, onJoyBtn } = handlersRef.current;
      if (!line) return;
      if (line.startsWith("ROT:")) {
        const raw = line.split(":")[1] ?? "";
        const delta = parseInt(raw, 10);
        if (!Number.isNaN(delta)) {
          setAngle((prev) => prev + delta);
          onRotate?.(delta);
        }
        return;
      }

      if (line.startsWith("JOY:")) {
        const raw = line.split(":")[1] ?? "";
        const [xs, ys] = raw.split(",");
        const x = parseInt(xs ?? "", 10);
        const y = parseInt(ys ?? "", 10);
        if (!Number.isNaN(x) && !Number.isNaN(y)) onJoy?.(x, y);
        return;
      }

      if (line.startsWith("JOYBTN")) {
        onJoyBtn?.();
        return;
      }

      if (line.startsWith("BTN3")) {
        onBtn3?.();
        return;
      }

      if (line.startsWith("BTN4")) {
        onBtn4?.();
        return;
      }

      if (line.startsWith("BTN2")) {
        onBtn2?.();
        return;
      }

      if (line.startsWith("BTN")) {
        onBtn?.();
      }
    },
    []
  );

  const connect = React.useCallback(async () => {
    if (!supportsSerial) {
      setError("Web Serial is not available in this browser.");
      return;
    }

    try {
      setError(null);
      await disconnect();

      const nav = navigator as NavigatorWithSerial;
      const port = await nav.serial!.requestPort();
      await port.open({ baudRate: BAUD_RATE });

      if (!port.readable) {
        throw new Error("Selected port is not readable.");
      }

      portRef.current = port;
      const reader = makeLineStream(port.readable).getReader();
      readerRef.current = reader;
      setIsConnected(true);

      const pump = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (typeof value === "string") handleLine(value);
        }
      };

      pump()
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : "Error reading from serial."
          );
        })
        .finally(() => {
          setIsConnected(false);
          portRef.current = null;
          cleanupReader();
        });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to open serial port.";
      setError(msg);
      await disconnect();
    }
  }, [supportsSerial, disconnect, handleLine, cleanupReader]);

  React.useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    angle,
    isConnected,
    error,
    isSupported: supportsSerial,
    connect,
    disconnect,
  };
}
