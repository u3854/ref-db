import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileImage,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api/client";
import type { SearchMatch, TagInfo } from "../types/api";

export type SimilarMode = "visual" | "head" | "torso" | "full_pose" | "visual_and_pose";

interface LightboxModalProps {
  matches: SearchMatch[];
  activeIndex: number | null;
  allTags: TagInfo[];
  onTagsUpdated: () => void;
  onDeleted: () => void;
  onFindSimilar: (item: SearchMatch, mode: SimilarMode, subjectIndex?: number) => void;
  onFilterByTag?: (tagId: number) => void;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}

export function LightboxModal({
  matches,
  activeIndex,
  allTags,
  onTagsUpdated,
  onDeleted,
  onFindSimilar,
  onFilterByTag,
  onClose,
  onNavigate,
}: LightboxModalProps) {
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [savingTag, setSavingTag] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const item = activeIndex !== null ? matches[activeIndex] ?? null : null;

  useEffect(() => {
    setCopiedPath(false);
    setCopiedImage(false);
    setCopyError(null);
    setTagInput("");
    setConfirmDelete(false);
  }, [activeIndex]);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && activeIndex > 0) onNavigate(activeIndex - 1);
      if (e.key === "ArrowRight" && activeIndex < matches.length - 1) {
        onNavigate(activeIndex + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, matches.length, onClose, onNavigate]);

  if (item === null || activeIndex === null) return null;

  const imgSrc = item.file_url;
  const primarySubject = item.poses.subjects[0];
  const primaryHead = primarySubject?.head ?? item.poses.heads[0] ?? null;
  const primaryTorso = primarySubject?.torso ?? item.poses.torsos[0] ?? null;

  const saveTagsList = async (nextNames: string[]) => {
    setSavingTag(true);
    try {
      await api.setImageTags(item.id, nextNames);
      onTagsUpdated();
    } finally {
      setSavingTag(false);
    }
  };

  const handleAddTag = async (rawName: string) => {
    const clean = rawName.trim();
    if (!clean) return;
    const current = item.tags.map((t) => t.name);
    if (!current.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      await saveTagsList([...current, clean]);
    }
    setTagInput("");
  };

  const handleRemoveTag = async (tagId: number) => {
    const nextNames = item.tags.filter((t) => t.id !== tagId).map((t) => t.name);
    await saveTagsList(nextNames);
  };

  const suggestedTags = allTags.filter(
    (t) => !item.tags.some((existing) => existing.id === t.id)
  );

  const handleCopyPath = async () => {
    await navigator.clipboard.writeText(item.path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1800);
  };

  const handleCopyImage = async () => {
    setCopyError(null);
    try {
      const response = await fetch(imgSrc);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
          "image/png"
        );
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 1800);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Failed to copy image");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await api.deleteImage(item.id);
      onClose();
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-stage">
          <img src={imgSrc} alt={item.filename} draggable />
          {activeIndex > 0 && (
            <button
              type="button"
              className="lightbox-nav prev"
              onClick={() => onNavigate(activeIndex - 1)}
              aria-label="Previous image"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {activeIndex < matches.length - 1 && (
            <button
              type="button"
              className="lightbox-nav next"
              onClick={() => onNavigate(activeIndex + 1)}
              aria-label="Next image"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        <div className="lightbox-sidebar">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={item.filename}
            >
              {item.filename}
            </span>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              <X size={14} />
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCopyImage}>
              {copiedImage ? <Check size={14} /> : <FileImage size={14} />}
              {copiedImage ? "Copied Image" : "Copy Image"}
            </button>
            <button type="button" className="btn btn-sm" onClick={handleCopyPath}>
              {copiedPath ? <Check size={14} /> : <Copy size={14} />}
              {copiedPath ? "Copied" : "Copy Label"}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              title="Permanently delete this reference from ref-db"
            >
              <Trash2 size={14} />
              {deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
          </div>

          {copyError && (
            <div style={{ fontSize: 12, color: "var(--danger)" }}>{copyError}</div>
          )}

          <div className="section-card">
            <div className="section-header">
              <span>Find Similar References</span>
              <Sparkles size={13} color="#5b8cff" />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onFindSimilar(item, "visual", 0)}
                title="Match style, lighting, subject, and composition semantically"
              >
                Visual / Semantics
              </button>
              {primaryHead && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onFindSimilar(item, "head", 0)}
                  title="Search other refs with this exact Head yaw & pitch"
                >
                  Same Head
                </button>
              )}
              {primaryTorso && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onFindSimilar(item, "torso", 0)}
                  title="Search other refs with this exact Torso turn & lean"
                >
                  Same Torso
                </button>
              )}
              {primaryHead && primaryTorso && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onFindSimilar(item, "full_pose", 0)}
                  title="Search other refs matching both Head and Torso pose"
                >
                  Full Pose
                </button>
              )}
              {(primaryHead || primaryTorso) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onFindSimilar(item, "visual_and_pose", 0)}
                  title="Combine semantic similarity with this pose"
                >
                  Visual + Pose
                </button>
              )}
            </div>
          </div>

          <div className="section-card">
            <div className="section-header">Custom Tags ({item.tags.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {item.tags.length === 0 ? (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  No custom tags yet.
                </span>
              ) : (
                item.tags.map((tag) => (
                  <span key={tag.id} className="tag-chip" style={{ borderColor: tag.color }}>
                    <span className="tag-dot" style={{ background: tag.color }} />
                    {onFilterByTag ? (
                      <button
                        type="button"
                        onClick={() => onFilterByTag(tag.id)}
                        title={`Search references tagged "${tag.name}"`}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          color: "inherit",
                        }}
                      >
                        {tag.name}
                      </button>
                    ) : (
                      <span>{tag.name}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag.id)}
                      disabled={savingTag}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        display: "inline-flex",
                        color: "var(--text-muted)",
                      }}
                      aria-label={`Remove ${tag.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))
              )}
            </div>

            <form
              style={{ display: "flex", gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                handleAddTag(tagInput);
              }}
            >
              <input
                className="input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Character, person, style..."
                disabled={savingTag}
              />
              <button
                type="submit"
                className="btn btn-sm"
                disabled={savingTag || !tagInput.trim()}
              >
                <Plus size={13} />
              </button>
            </form>

            {suggestedTags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {suggestedTags.slice(0, 8).map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="btn btn-sm"
                    style={{ fontSize: 11, padding: "2px 7px" }}
                    disabled={savingTag}
                    onClick={() => handleAddTag(tag.name)}
                  >
                    + {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="section-card">
            <div className="section-header">Metadata</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Stored JPEG: {item.width} × {item.height} px ({item.source_type ?? "folder"})
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Match Score: {(item.score * 100).toFixed(2)}% | Pose: {(item.pose_score * 100).toFixed(0)}%
            </div>
            <div className="mono" style={{ color: "var(--text-muted)" }}>
              {item.path}
            </div>
          </div>

          <div className="section-card">
            <div className="section-header">
              Detected Subjects ({item.poses.subjects.length})
            </div>
            {item.poses.subjects.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                No human faces or torsos detected.
              </div>
            ) : (
              item.poses.subjects.map((subj, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    background: "var(--bg-canvas)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>Subject #{idx + 1}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {subj.head && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: "2px 6px" }}
                          onClick={() => onFindSimilar(item, "head", idx)}
                        >
                          Head
                        </button>
                      )}
                      {subj.torso && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: "2px 6px" }}
                          onClick={() => onFindSimilar(item, "torso", idx)}
                        >
                          Torso
                        </button>
                      )}
                      {subj.head && subj.torso && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: "2px 6px" }}
                          onClick={() => onFindSimilar(item, "full_pose", idx)}
                        >
                          Pose
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    Head:{" "}
                    {subj.head
                      ? `Yaw ${subj.head.yaw}° · Pitch ${subj.head.pitch}° · Roll ${subj.head.roll}°`
                      : "Not detected"}
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    Torso:{" "}
                    {subj.torso
                      ? `Yaw ${subj.torso.yaw}° · Lean ${subj.torso.lean}°`
                      : "Not detected"}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: "auto" }}>
            Tip: Click &ldquo;Copy Image&rdquo; and press Ctrl+V in Clip Studio Paint, or drag the
            preview directly onto your canvas.
          </div>
        </div>
      </div>
    </div>
  );
}
