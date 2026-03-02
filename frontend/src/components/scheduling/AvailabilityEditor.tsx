import { useState, useEffect, useCallback, useRef } from "react";
import type { AvailabilityWindow } from "../../types";
import { Button } from "../Button";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOTS_PER_DAY: string[] = [];
for (let h = 7; h < 21; h++) {
  for (const m of [0, 30]) {
    const hh = h.toString().padStart(2, "0");
    const mm = m.toString().padStart(2, "0");
    SLOTS_PER_DAY.push(`${hh}:${mm}`);
  }
}

function slotLabel(time: string): string {
  const parts = time.split(":").map(Number);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const h = hh % 12 || 12;
  const ampm = hh < 12 ? "a" : "p";
  return mm === 0 ? `${h}${ampm}` : `${h}:${mm.toString().padStart(2, "0")}${ampm}`;
}

interface AvailabilityEditorProps {
  initialWindows: AvailabilityWindow[];
  onSave: (windows: AvailabilityWindow[]) => Promise<void>;
}

/** Parse a data-cell attribute like "3-12" → { day: 3, slot: 12 } */
function parseCellAttr(el: Element | null): { day: number; slot: number } | null {
  const attr = el?.getAttribute?.("data-cell");
  if (!attr) return null;
  const [d, s] = attr.split("-").map(Number);
  if (d == null || s == null || isNaN(d) || isNaN(s)) return null;
  return { day: d, slot: s };
}

export function AvailabilityEditor({
  initialWindows,
  onSave,
}: AvailabilityEditorProps) {
  const [grid, setGrid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Drag state
  const dragging = useRef(false);
  const paintValue = useRef(true); // true = paint ON, false = paint OFF
  const lastCell = useRef<string | null>(null);

  // Initialize grid from windows
  useEffect(() => {
    const g: Record<string, boolean> = {};
    for (const w of initialWindows) {
      const startIdx = SLOTS_PER_DAY.indexOf(w.start_time);
      const endIdx = SLOTS_PER_DAY.indexOf(w.end_time);
      if (startIdx >= 0 && endIdx > startIdx) {
        for (let i = startIdx; i < endIdx; i++) {
          g[`${w.day_of_week}-${i}`] = true;
        }
      }
    }
    setGrid(g);
  }, [initialWindows]);

  const paintCell = useCallback((day: number, slot: number, value: boolean) => {
    const key = `${day}-${slot}`;
    if (lastCell.current === key) return; // already painted this cell
    lastCell.current = key;
    setGrid((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  // --- Mouse handlers ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const cell = parseCellAttr(e.target as Element);
      if (!cell) return;
      e.preventDefault();
      dragging.current = true;
      const key = `${cell.day}-${cell.slot}`;
      // If cell is currently active, we're erasing; otherwise painting
      paintValue.current = !grid[key];
      lastCell.current = null;
      paintCell(cell.day, cell.slot, paintValue.current);
    },
    [grid, paintCell],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging.current) return;
      const cell = parseCellAttr(e.target as Element);
      if (!cell) return;
      paintCell(cell.day, cell.slot, paintValue.current);
    },
    [paintCell],
  );

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
    lastCell.current = null;
  }, []);

  // --- Touch handlers ---
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const cell = parseCellAttr(el);
      if (!cell) return;
      e.preventDefault(); // prevent scrolling while dragging on grid
      dragging.current = true;
      const key = `${cell.day}-${cell.slot}`;
      paintValue.current = !grid[key];
      lastCell.current = null;
      paintCell(cell.day, cell.slot, paintValue.current);
    },
    [grid, paintCell],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragging.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const cell = parseCellAttr(el);
      if (!cell) return;
      paintCell(cell.day, cell.slot, paintValue.current);
    },
    [paintCell],
  );

  const handleTouchEnd = useCallback(() => {
    dragging.current = false;
    lastCell.current = null;
  }, []);

  // End drag if mouse leaves the grid
  const handleMouseLeave = useCallback(() => {
    dragging.current = false;
    lastCell.current = null;
  }, []);

  // Convert grid back to windows (consecutive slots → single window)
  function gridToWindows(): AvailabilityWindow[] {
    const windows: AvailabilityWindow[] = [];
    for (let day = 0; day < 7; day++) {
      let rangeStart: number | null = null;
      for (let i = 0; i <= SLOTS_PER_DAY.length; i++) {
        const active = grid[`${day}-${i}`];
        if (active && rangeStart === null) {
          rangeStart = i;
        } else if (!active && rangeStart !== null) {
          windows.push({
            day_of_week: day,
            start_time: SLOTS_PER_DAY[rangeStart] ?? "07:00",
            end_time: SLOTS_PER_DAY[i] ?? "21:00",
          });
          rangeStart = null;
        }
      }
    }
    return windows;
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(gridToWindows());
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-warm-500">
          Click or drag to toggle availability.
        </p>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-teal-600 font-medium">Saved</span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Availability"}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-warm-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div
            className="grid grid-cols-[56px_repeat(7,1fr)] min-w-[640px] select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Day headers */}
            <div className="bg-warm-50 border-b border-warm-200" />
            {DAYS.map((d, i) => (
              <div
                key={i}
                className="bg-warm-50 border-b border-l border-warm-200 text-center py-2.5 text-xs font-semibold text-warm-600 uppercase tracking-wide"
              >
                {d}
              </div>
            ))}

            {/* Time slots */}
            {SLOTS_PER_DAY.map((time, slotIdx) => (
              <div key={slotIdx} className="contents">
                <div className="h-8 flex items-center justify-end pr-2 text-[11px] text-warm-400 border-t border-warm-50">
                  {slotIdx % 2 === 0 ? slotLabel(time) : ""}
                </div>
                {DAYS.map((_, day) => {
                  const active = grid[`${day}-${slotIdx}`];
                  return (
                    <div
                      key={day}
                      data-cell={`${day}-${slotIdx}`}
                      className={`h-8 border-l border-t border-warm-50 cursor-pointer transition-colors ${
                        active
                          ? "bg-teal-600 hover:bg-teal-700"
                          : "hover:bg-teal-50"
                      }`}
                      role="gridcell"
                      aria-label={`${DAYS[day]} ${time} ${active ? "available" : "unavailable"}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-warm-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-teal-600" />
          Available
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-white border border-warm-200" />
          Unavailable
        </div>
      </div>
    </div>
  );
}
