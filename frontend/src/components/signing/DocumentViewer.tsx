import { templateRegistry } from "../../templates";
import type { PracticeInfo } from "../../templates";

interface DocumentViewerProps {
  templateKey: string;
  content: Record<string, any>;
  practice?: PracticeInfo | null;
}

export function DocumentViewer({ templateKey, content, practice }: DocumentViewerProps) {
  const Template = templateRegistry[templateKey];

  if (!Template) {
    return (
      <div className="p-8 text-center text-warm-500">
        Unknown document template: {templateKey}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-warm-200 p-8 md:p-12">
      <Template content={content} practice={practice} />
    </div>
  );
}
