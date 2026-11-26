import { useEffect, useState } from "react";
import { ImagePlus, Loader2, Plus, Tag, X } from "lucide-react";
import type { TagInfo } from "../types/api";

interface ImportConfirmModalProps {
  files: File[];
  sourceType: "upload" | "paste";
  existingTags: TagInfo[];
  importing: boolean;
  onRemoveFile: (index: number) => void;
  onConfirm: (tags: string[], viewAfterImport: boolean) => void;
  onCancel: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function ImportConfirmModal({
  files,
  sourceType,
  existingTags,
  importing,
  onRemoveFile,
  onConfirm,
  onCancel,
}: ImportConfirmModalProps) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [viewAfterImport, setViewAfterImport] = useState(true);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  useEffect(() => {
    if (files.length === 0) {
      setSelectedTags([]);
      setTagInput("");
    }
  }, [files.length]);

  useEffect(() => {
    if (files.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importing) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [files.length, importing, onCancel]);

  if (files.length === 0) return null;

  const addTag = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    if (!selectedTags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setSelectedTags((prev) => [...prev, clean]);
    }
    setTagInput("");
  };

  const toggleExistingTag = (name: string) => {
    const exists = selectedTags.some((t) => t.toLowerCase() === name.toLowerCase());
    if (exists) {
      setSelectedTags((prev) => prev.filter((t) => t.toLowerCase() !== name.toLowerCase()));
    } else {
      setSelectedTags((prev) => [...prev, name]);
    }
  };

  const removeSelectedTag = (name: string) => {
    setSelectedTags((prev) => prev.filter((t) => t.toLowerCase() !== name.toLowerCase()));
  };

  return (
    <div className="modal-backdrop" onClick={() => (!importing ? onCancel() : undefined)}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ImagePlus size={16} color="#5b8cff" />
            Confirm Import ({files.length} {files.length === 1 ? "image" : "images"} ·{" "}
            {sourceType === "paste" ? "Clipboard Paste" : "Files"})
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onCancel}
            disabled={importing}
          >
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="import-preview-grid">
            {files.map((file, idx) => (
              <div key={`${file.name}-${file.size}-${idx}`} className="import-preview-card">
                <div className="import-preview-thumb">
                  {previews[idx] && <img src={previews[idx]} alt={file.name} />}
                  <button
                    type="button"
                    className="import-remove-btn"
                    onClick={() => onRemoveFile(idx)}
                    disabled={importing}
                    title="Remove from import queue"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="import-preview-meta">
                  <div className="thumb-title" title={file.name}>
                    {file.name || "pasted-image.png"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {formatFileSize(file.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-card">
            <div className="section-header">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Tag size={13} />
                Assign Tags to Imported Images (Optional)
              </span>
              <span>{selectedTags.length} selected</span>
            </div>

            {selectedTags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedTags.map((tagName) => (
                  <span key={tagName} className="tag-chip active">
                    <span>{tagName}</span>
                    <button
                      type="button"
                      onClick={() => removeSelectedTag(tagName)}
                      disabled={importing}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        display: "inline-flex",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <form
              style={{ display: "flex", gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                addTag(tagInput);
              }}
            >
              <input
                className="input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Type a new or existing tag and press Enter..."
                disabled={importing}
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-sm"
                disabled={importing || !tagInput.trim()}
              >
                <Plus size={14} /> Add Tag
              </button>
            </form>

            {existingTags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {existingTags.slice(0, 16).map((tag) => {
                  const active = selectedTags.some(
                    (t) => t.toLowerCase() === tag.name.toLowerCase()
                  );
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`tag-chip ${active ? "active" : ""}`}
                      onClick={() => toggleExistingTag(tag.name)}
                      disabled={importing}
                    >
                      <span className="tag-dot" style={{ background: tag.color }} />
                      <span>{tag.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={viewAfterImport}
                onChange={(e) => setViewAfterImport(e.target.checked)}
                disabled={importing}
              />
              View newly imported images after confirming
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={onCancel}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importing || files.length === 0}
                onClick={() => {
                  const finalTags = tagInput.trim()
                    ? Array.from(new Set([...selectedTags, tagInput.trim()]))
                    : selectedTags;
                  onConfirm(finalTags, viewAfterImport);
                }}
              >
                {importing ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    Importing & Indexing...
                  </>
                ) : (
                  `Confirm & Import (${files.length})`
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
