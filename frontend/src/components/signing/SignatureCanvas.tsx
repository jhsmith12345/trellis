import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "../Button";

interface SignatureCanvasProps {
  onSign: (dataUrl: string) => void;
  disabled?: boolean;
}

export function SignatureCanvas({ onSign, disabled }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const getPos = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    []
  );

  // Setup canvas resolution on mount / resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      drawBaseline();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function drawBaseline() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Baseline
    const y = canvas.height * 0.75;
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(canvas.width - 40, y);
    ctx.strokeStyle = "#d6d3d1";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Placeholder text
    ctx.font = "28px -apple-system, sans-serif";
    ctx.fillStyle = "#a8a29e";
    ctx.textAlign = "center";
    ctx.fillText("Sign here", canvas.width / 2, y - 20);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    // On first stroke, clear the placeholder
    if (!hasStrokes) {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Redraw baseline only
      const y = canvas.height * 0.75;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(canvas.width - 40, y);
      ctx.strokeStyle = "#d6d3d1";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    lastPoint.current = getPos(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);

    if (lastPoint.current) {
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#1c1917";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    lastPoint.current = pos;
    setHasStrokes(true);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    setIsDrawing(false);
    lastPoint.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function handleClear() {
    setHasStrokes(false);
    drawBaseline();
  }

  function handleSign() {
    if (!hasStrokes) return;
    const canvas = canvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    onSign(dataUrl);
  }

  return (
    <div className="space-y-3">
      <div className="border-2 border-warm-200 rounded-xl overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair"
          style={{ height: 200, touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <div className="flex gap-3 justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={!hasStrokes || disabled}
        >
          Clear
        </Button>
        <Button
          size="sm"
          onClick={handleSign}
          disabled={!hasStrokes || disabled}
        >
          Sign Document
        </Button>
      </div>
    </div>
  );
}
