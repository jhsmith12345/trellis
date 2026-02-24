/**
 * TipTap-based rich text editor for a single clinical note section.
 *
 * Supports: bold, italic, underline, bullet lists, ordered lists, headings.
 * Content is stored as HTML.
 */
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";

interface SectionEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export function SectionEditor({
  content,
  onChange,
  placeholder,
  readOnly = false,
}: SectionEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
      }),
      Underline,
      Placeholder.configure({
        placeholder: placeholder || "Enter content...",
      }),
    ],
    content: content || "",
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Update editable state if readOnly changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  // Update content if it changes externally (e.g., after regeneration)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) {
    return <div className="h-24 animate-pulse bg-warm-50 rounded" />;
  }

  if (readOnly) {
    return (
      <div className="tiptap-content prose prose-sm max-w-none text-warm-700">
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className="border border-warm-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-teal-200 focus-within:border-teal-400 transition-colors">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-warm-50 border-b border-warm-200 flex-wrap">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <span className="font-bold text-xs">B</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <span className="italic text-xs">I</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
        >
          <span className="underline text-xs">U</span>
        </ToolbarButton>

        <div className="w-px h-5 bg-warm-200 mx-1" />

        <ToolbarButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading"
        >
          <span className="font-bold text-xs">H3</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 4 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          title="Subheading"
        >
          <span className="font-bold text-xs">H4</span>
        </ToolbarButton>

        <div className="w-px h-5 bg-warm-200 mx-1" />

        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <BulletListIcon />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered List"
        >
          <OrderedListIcon />
        </ToolbarButton>
      </div>

      {/* Editor area */}
      <div className="px-3 py-2 min-h-[100px]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar button sub-component
// ---------------------------------------------------------------------------

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`
        w-7 h-7 flex items-center justify-center rounded transition-colors
        ${active ? "bg-teal-100 text-teal-800" : "text-warm-500 hover:bg-warm-100 hover:text-warm-700"}
      `}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Toolbar icons
// ---------------------------------------------------------------------------

function BulletListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <circle cx="2.5" cy="4" r="1.5" />
      <circle cx="2.5" cy="8" r="1.5" />
      <circle cx="2.5" cy="12" r="1.5" />
      <rect x="6" y="3" width="9" height="2" rx="0.5" />
      <rect x="6" y="7" width="9" height="2" rx="0.5" />
      <rect x="6" y="11" width="9" height="2" rx="0.5" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <text x="1" y="5.5" fontSize="5" fontWeight="bold">1</text>
      <text x="1" y="9.5" fontSize="5" fontWeight="bold">2</text>
      <text x="1" y="13.5" fontSize="5" fontWeight="bold">3</text>
      <rect x="6" y="3" width="9" height="2" rx="0.5" />
      <rect x="6" y="7" width="9" height="2" rx="0.5" />
      <rect x="6" y="11" width="9" height="2" rx="0.5" />
    </svg>
  );
}
