import { Check, FolderOpen, ImageOff } from "lucide-react";
import type { SearchMatch } from "../types/api";

interface GalleryGridProps {
  matches: SearchMatch[];
  totalIndexed: number;
  loading: boolean;
  selectionMode: boolean;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelect: (index: number) => void;
  onOpenFolders: () => void;
}

export function GalleryGrid({
  matches,
  totalIndexed,
  loading,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onSelect,
  onOpenFolders,
}: GalleryGridProps) {
  if (totalIndexed === 0) {
    return (
      <div className="empty-state">
        <FolderOpen size={38} strokeWidth={1.5} />
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
          No reference folders indexed yet
        </div>
        <div style={{ maxWidth: 420, fontSize: 13 }}>
          Add a reference folder, drop image files anywhere here, or press{" "}
          <strong>Ctrl+V</strong> to paste images directly from X, Pinterest, or your clipboard.
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenFolders}>
          Add & Index Reference Folder
        </button>
      </div>
    );
  }

  if (!loading && matches.length === 0) {
    return (
      <div className="empty-state">
        <ImageOff size={36} strokeWidth={1.5} />
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
          No references matched those filters
        </div>
        <div style={{ maxWidth: 400, fontSize: 13 }}>
          Try widening Head/Torso angle tolerances, switching to &ldquo;Any Head/Torso&rdquo;, or
          broadening your semantic search query.
        </div>
      </div>
    );
  }

  return (
    <div className="gallery-grid">
      {matches.map((item, idx) => {
        const primaryHead = item.poses.heads[0];
        const primaryTorso = item.poses.torsos[0];
        const isSelected = selectedIds.has(item.id);
        return (
          <div
            key={item.id}
            className={`thumb-card ${isSelected ? "selected" : ""}`}
            onClick={() => {
              if (selectionMode) {
                onToggleSelect(item.id);
              } else {
                onSelect(idx);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (selectionMode) {
                  onToggleSelect(item.id);
                } else {
                  onSelect(idx);
                }
              }
            }}
          >
            {selectionMode && (
              <div className="thumb-select-badge">
                {isSelected && <Check size={14} color="#5b8cff" />}
              </div>
            )}
            <div className="thumb-frame">
              <img src={item.thumb_url} alt={item.filename} loading="lazy" />
            </div>
            <div className="thumb-footer">
              <div className="thumb-title" title={item.path}>
                {item.filename}
              </div>
              <div className="thumb-badges">
                <span className="badge score">{(item.score * 100).toFixed(1)}%</span>
                {primaryHead && (
                  <span className="badge">
                    H {primaryHead.yaw}°/{primaryHead.pitch}°
                  </span>
                )}
                {primaryTorso && (
                  <span className="badge">
                    T {primaryTorso.yaw}°/{primaryTorso.lean}°
                  </span>
                )}
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag.id} className="badge" style={{ borderColor: tag.color }}>
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
