import {
  Check,
  Compass,
  FolderOpen,
  ImageOff,
  Layers,
  Sparkles,
  Tag,
  UserCheck,
} from "lucide-react";
import type { FolderInfo, LibraryStatsResponse, SearchMatch, TagInfo } from "../types/api";

interface GalleryGridProps {
  matches: SearchMatch[];
  hasSearched: boolean;
  totalIndexed: number;
  loading: boolean;
  stats: LibraryStatsResponse | null;
  tags: TagInfo[];
  folders: FolderInfo[];
  selectionMode: boolean;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelect: (index: number) => void;
  onFindSimilarVisual: (item: SearchMatch) => void;
  onBrowseAll: () => void;
  onQuickTagSearch: (tagId: number) => void;
  onQuickPoseSearch: (preset: "front" | "3q_left" | "3q_right" | "back") => void;
  onOpenFolders: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function GalleryGrid({
  matches,
  hasSearched,
  totalIndexed,
  loading,
  stats,
  tags,
  folders,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onSelect,
  onFindSimilarVisual,
  onBrowseAll,
  onQuickTagSearch,
  onQuickPoseSearch,
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

  if (!hasSearched) {
    const s = stats;
    return (
      <div className="landing-summary">
        <div className="landing-hero">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                Reference Library Ready
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                Type a semantic description above, dial a Head or Torso angle on the left, or press{" "}
                <strong>Ctrl+V</strong> to import an image from your clipboard.
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={onBrowseAll}>
              <Layers size={15} />
              Browse All References
            </button>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={14} color="#5b8cff" />
              Stored References
            </div>
            <div className="stat-value">{s ? s.total_images : totalIndexed}</div>
            <div className="stat-sub">
              {s
                ? `${s.folder_source_count} folder · ${s.direct_import_count} pasted/dropped`
                : "Ready to search"}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <UserCheck size={14} color="#34d399" />
              Head Poses Detected
            </div>
            <div className="stat-value">{s ? s.images_with_head : "—"}</div>
            <div className="stat-sub">
              {s ? `${s.images_with_both} refs with paired head + torso` : "3D Yaw & Pitch"}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Compass size={14} color="#a78bfa" />
              Torso Poses Detected
            </div>
            <div className="stat-value">{s ? s.images_with_torso : "—"}</div>
            <div className="stat-sub">360° Front/Back Turn & Lean</div>
          </div>

          <div className="stat-card">
            <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Tag size={14} color="#fbbf24" />
              Tags & Managed Cache
            </div>
            <div className="stat-value">{s ? s.total_tags : tags.length}</div>
            <div className="stat-sub">
              {s
                ? `${formatBytes(s.storage_bytes)} JPEG cache · ${folders.length} linked folder(s)`
                : `${folders.length} linked folder(s)`}
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-header">Quick Pose Search</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onQuickPoseSearch("front")}
            >
              Front Facing
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onQuickPoseSearch("3q_left")}
            >
              3/4 Left
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onQuickPoseSearch("3q_right")}
            >
              3/4 Right
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onQuickPoseSearch("back")}
            >
              Back / Over-Shoulder
            </button>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="section-card">
            <div className="section-header">Jump to Custom Tag</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tags.slice(0, 18).map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="tag-chip"
                  onClick={() => onQuickTagSearch(tag.id)}
                >
                  <span className="tag-dot" style={{ background: tag.color }} />
                  <span>{tag.name}</span>
                  <span style={{ color: "var(--text-muted)" }}>{tag.image_count ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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
          Try widening Head/Torso angle tolerances, switching to &ldquo;Any Head / Torso&rdquo;,
          or broadening your semantic search query.
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
            {selectionMode ? (
              <div className="thumb-select-badge">
                {isSelected && <Check size={14} color="#5b8cff" />}
              </div>
            ) : (
              <button
                type="button"
                className="thumb-similar-btn"
                title="Find visually similar references"
                onClick={(e) => {
                  e.stopPropagation();
                  onFindSimilarVisual(item);
                }}
              >
                <Sparkles size={11} />
                Similar
              </button>
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
