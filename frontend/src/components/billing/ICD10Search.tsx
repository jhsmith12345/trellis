import { useState, useEffect, useRef, useCallback } from "react";
import { useApi } from "../../hooks/useApi";

interface ICD10Code {
  code: string;
  description: string;
}

interface ICD10SearchProps {
  onSelect: (code: ICD10Code) => void;
  excludeCodes?: string[];
}

export function ICD10Search({ onSelect, excludeCodes = [] }: ICD10SearchProps) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ICD10Code[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const excludeSet = new Set(excludeCodes);

  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const data = await api.get<{ results: ICD10Code[] }>(
          `/api/icd10/search?q=${encodeURIComponent(q)}&scope=mental_health`
        );
        const filtered = data.results.filter((r) => !excludeSet.has(r.code));
        setResults(filtered);
        setOpen(filtered.length > 0);
        setHighlightIdx(0);
      } catch (err) {
        console.error("ICD-10 search failed:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [api, excludeCodes.join(",")]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlightIdx]) {
        handleSelect(results[highlightIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleSelect(code: ICD10Code) {
    onSelect(code);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search ICD-10 codes (e.g., F32, depression, anxiety)..."
            className="w-full px-3 py-2 text-sm border border-warm-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 pr-8"
          />
          {loading && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <span className="w-4 h-4 block border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-warm-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={r.code}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full px-3 py-2 text-left text-sm flex items-start gap-2 transition-colors ${
                i === highlightIdx ? "bg-teal-50 text-teal-800" : "text-warm-700 hover:bg-warm-50"
              }`}
            >
              <span className="font-mono font-semibold text-xs bg-warm-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                {r.code}
              </span>
              <span className="text-xs leading-relaxed">{r.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
