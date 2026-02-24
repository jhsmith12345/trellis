import { useState, useEffect, useCallback } from "react";
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

export function AvailabilityEditor({
  initialWindows,
  onSave,
}: AvailabilityEditorProps) {
  // Track which (day, slot) combos are active
  const [grid, setGrid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const toggle = useCallback((day: number, slotIdx: number) => {
    const key = `${day}-${slotIdx}`;
    setGrid((prev) => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
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
          Click time blocks to toggle availability. Drag to select multiple.
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
          <div className="grid grid-cols-[56px_repeat(7,1fr)] min-w-[640px]">
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
                    <button
                      key={day}
                      onClick={() => toggle(day, slotIdx)}
                      className={`h-8 border-l border-t border-warm-50 transition-colors ${
                        active
                          ? "bg-teal-400 hover:bg-teal-500"
                          : "hover:bg-teal-50"
                      }`}
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
          <div className="w-3 h-3 rounded bg-teal-400" />
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
