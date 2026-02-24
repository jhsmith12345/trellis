interface Doc {
  id: string;
  title: string;
  status: "pending" | "signed";
}

interface DocumentProgressProps {
  documents: Doc[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export function DocumentProgress({
  documents,
  currentIndex,
  onSelect,
}: DocumentProgressProps) {
  return (
    <nav className="space-y-1">
      {documents.map((doc, i) => {
        const isCurrent = i === currentIndex;
        const isSigned = doc.status === "signed";

        return (
          <button
            key={doc.id}
            onClick={() => onSelect(i)}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors flex items-center gap-3 ${
              isCurrent
                ? "bg-teal-50 text-teal-800 font-medium"
                : "text-warm-600 hover:bg-warm-100"
            }`}
          >
            {/* Step indicator */}
            <span
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                isSigned
                  ? "bg-teal-600 text-white"
                  : isCurrent
                    ? "bg-teal-100 text-teal-700 ring-2 ring-teal-600"
                    : "bg-warm-200 text-warm-500"
              }`}
            >
              {isSigned ? (
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="truncate">{doc.title}</span>
          </button>
        );
      })}
    </nav>
  );
}
