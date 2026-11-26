import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckSquare,
  FolderCog,
  ImagePlus,
  Loader2,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "./api/client";
import { FolderManagerModal } from "./components/FolderManagerModal";
import { GalleryGrid } from "./components/GalleryGrid";
import { LightboxModal } from "./components/LightboxModal";
import { PoseControls } from "./components/PoseControls";
import type {
  FolderInfo,
  HealthResponse,
  IndexStatus,
  SearchMatch,
  SearchRequest,
  TagInfo,
} from "./types/api";

const INITIAL_FILTERS: SearchRequest = {
  query: "",
  folder_id: null,
  tag_ids: [],
  tag_mode: "all",
  use_head_yaw: false,
  head_yaw: 0,
  use_head_pitch: false,
  head_pitch: 0,
  head_tol: 20,
  use_torso_yaw: false,
  torso_yaw: 0,
  use_torso_lean: false,
  torso_lean: 0,
  torso_tol: 25,
  match_mode: "paired",
  top_k: 36,
};

const INITIAL_INDEX_STATUS: IndexStatus = {
  running: false,
  cancelling: false,
  folder_path: null,
  phase: "idle",
  processed: 0,
  total: 0,
  added: 0,
  updated: 0,
  skipped_unchanged: 0,
  pruned: 0,
  errors: 0,
  current_file: null,
  message: "Idle",
};

export function App() {
  const [filters, setFilters] = useState<SearchRequest>(INITIAL_FILTERS);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>(INITIAL_INDEX_STATUS);

  const [foldersModalOpen, setFoldersModalOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchTagInput, setBatchTagInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filtersRef = useRef<SearchRequest>(filters);
  filtersRef.current = filters;

  const refreshMeta = useCallback(async () => {
    try {
      const [h, f, t] = await Promise.all([api.health(), api.listFolders(), api.listTags()]);
      setHealth(h);
      setFolders(f);
      setTags(t);
      setTotalIndexed(h.total_images);
    } catch {
      // Backend might still be starting
    }
  }, []);

  const runSearch = useCallback(async (req: SearchRequest) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.search(req);
      setMatches(res.matches);
      setTotalMatches(res.total_matches);
      setTotalIndexed(res.total_indexed);
      setElapsedMs(res.elapsed_ms);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  const handleImportFiles = useCallback(
    async (files: File[], sourceType: "upload" | "paste") => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(f.name));
      if (imageFiles.length === 0) return;

      setImporting(true);
      setToast(`Importing ${imageFiles.length} reference image(s)...`);
      try {
        const res = await api.importImages(imageFiles, sourceType);
        const parts = [`Imported ${res.imported.length}`];
        if (res.skipped_duplicates > 0) parts.push(`${res.skipped_duplicates} duplicate(s) skipped`);
        if (res.errors > 0) parts.push(`${res.errors} failed`);
        setToast(parts.join(" · "));
        await refreshMeta();
        await runSearch(filtersRef.current);
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImporting(false);
      }
    },
    [refreshMeta, runSearch]
  );

  useEffect(() => {
    refreshMeta();
    runSearch(INITIAL_FILTERS);
  }, [refreshMeta, runSearch]);

  // Global clipboard image paste (Ctrl+V from X, Pinterest, Snipping Tool, etc.)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleImportFiles(files, "paste");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleImportFiles]);

  // Global drag-and-drop file import
  useEffect(() => {
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounter += 1;
        setDragActive(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDragLeave = () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        handleImportFiles(files, "upload");
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleImportFiles]);

  // Subscribe to live indexer SSE progress once on mount
  useEffect(() => {
    const es = new EventSource("/api/index/events");
    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as IndexStatus;
        setIndexStatus(parsed);
        if (!parsed.running && (parsed.phase === "done" || parsed.phase === "cancelled")) {
          refreshMeta();
          runSearch(filtersRef.current);
        }
      } catch {
        // Ignore keep-alive parse errors
      }
    };
    return () => es.close();
  }, [refreshMeta, runSearch]);

  const patchFilters = (patch: Partial<SearchRequest>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const toggleFilterTag = (tagId: number) => {
    const exists = filters.tag_ids.includes(tagId);
    const next = exists
      ? filters.tag_ids.filter((id) => id !== tagId)
      : [...filters.tag_ids, tagId];
    patchFilters({ tag_ids: next });
  };

  const toggleSelectImage = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchAddTag = async (name: string) => {
    const clean = name.trim();
    if (!clean || selectedIds.size === 0) return;
    await api.batchTags(Array.from(selectedIds), [clean], []);
    setBatchTagInput("");
    await refreshMeta();
    await runSearch(filters);
  };

  const handleBatchRemoveTag = async (name: string) => {
    if (selectedIds.size === 0) return;
    await api.batchTags(Array.from(selectedIds), [], [name]);
    await refreshMeta();
    await runSearch(filters);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    await api.batchDeleteImages(Array.from(selectedIds));
    setSelectedIds(new Set());
    setToast(`Deleted ${count} reference(s) from ref-db`);
    await refreshMeta();
    await runSearch(filters);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>ref-db</span>
          <span className="brand-badge">SigLIP + 3D Pose</span>
        </div>

        <div className="topbar-right">
          {(indexStatus.running || importing) && (
            <button
              type="button"
              className="status-pill"
              onClick={() => setFoldersModalOpen(true)}
              style={{ cursor: "pointer" }}
            >
              <Loader2 size={13} className="spin" />
              <span>
                {importing
                  ? "Importing..."
                  : `Importing ${indexStatus.processed}/${indexStatus.total || "?"}`}
              </span>
            </button>
          )}

          {health && (
            <div className="status-pill" title={health.gpu_name ?? health.device}>
              <span className={`dot ${health.device === "cpu" ? "warn" : ""}`} />
              <span>
                {health.device.toUpperCase()} ({health.dtype}) · {health.total_images} refs
              </span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) handleImportFiles(files, "upload");
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            title="Import loose image files (or drop / Ctrl+V anywhere)"
          >
            <ImagePlus size={15} />
            Import Files
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setFoldersModalOpen(true)}
          >
            <FolderCog size={15} />
            Folders & Settings
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <PoseControls filters={filters} onChange={patchFilters} />

        <div className="section-card">
          <div className="section-header">
            <span>Custom Tags</span>
            {filters.tag_ids.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => patchFilters({ tag_ids: [] })}
              >
                Clear
              </button>
            )}
          </div>
          {tags.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Tag characters, people, or styles via the Lightbox or Select mode.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tags.map((tag) => {
                  const active = filters.tag_ids.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`tag-chip ${active ? "active" : ""}`}
                      onClick={() => toggleFilterTag(tag.id)}
                    >
                      <span className="tag-dot" style={{ background: tag.color }} />
                      <span>{tag.name}</span>
                      <span style={{ color: "var(--text-muted)" }}>{tag.image_count ?? 0}</span>
                    </button>
                  );
                })}
              </div>
              {filters.tag_ids.length > 1 && (
                <div className="control-row">
                  <span>Tag logic</span>
                  <select
                    className="select"
                    style={{ width: "auto", padding: "3px 8px", fontSize: 12 }}
                    value={filters.tag_mode}
                    onChange={(e) =>
                      patchFilters({ tag_mode: e.target.value as "all" | "any" })
                    }
                  >
                    <option value="all">Match All</option>
                    <option value="any">Match Any</option>
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        <div className="section-card">
          <div className="section-header">Scope & Limit</div>
          <select
            className="select"
            value={filters.folder_id ?? ""}
            onChange={(e) =>
              patchFilters({
                folder_id: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">All Stored References</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path} ({f.image_count})
              </option>
            ))}
          </select>

          <div className="slider-block">
            <div className="slider-head">
              <span>Max Results</span>
              <span>{filters.top_k}</span>
            </div>
            <input
              type="range"
              min={6}
              max={120}
              step={6}
              value={filters.top_k}
              onChange={(e) => patchFilters({ top_k: Number(e.target.value) })}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => runSearch(filters)}
            disabled={searching}
          >
            <Search size={15} />
            {searching ? "Searching..." : "Apply Filters"}
          </button>
        </div>
      </aside>

      <main className="main-area">
        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(filters);
          }}
        >
          <div className="search-input-wrap">
            <Search size={16} className="search-input-icon" />
            <input
              className="search-input"
              value={filters.query}
              onChange={(e) => patchFilters({ query: e.target.value })}
              placeholder='Search outfit, lighting, prop, or Ctrl+V paste an image to import...'
            />
          </div>
          <button
            type="button"
            className={`btn ${selectionMode ? "btn-primary" : ""}`}
            onClick={() => {
              setSelectionMode((prev) => !prev);
              setSelectedIds(new Set());
            }}
          >
            <CheckSquare size={15} />
            {selectionMode ? "Done Selecting" : "Select & Tag"}
          </button>
          <button type="submit" className="btn btn-primary" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        <div className="results-meta">
          <span>
            {searchError ? (
              <span style={{ color: "var(--danger)" }}>{searchError}</span>
            ) : (
              `Showing ${matches.length} of ${totalMatches} matches (${totalIndexed} stored)`
            )}
          </span>
          {elapsedMs !== null && <span>{elapsedMs.toFixed(1)} ms</span>}
        </div>

        {toast && (
          <div className="toast-banner">
            <span>{toast}</span>
            <button type="button" className="btn btn-sm" onClick={() => setToast(null)}>
              <X size={13} />
            </button>
          </div>
        )}

        <div className="gallery-scroll">
          <GalleryGrid
            matches={matches}
            totalIndexed={totalIndexed}
            loading={searching}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelectImage}
            onSelect={(idx) => setLightboxIndex(idx)}
            onOpenFolders={() => setFoldersModalOpen(true)}
          />
        </div>

        {selectionMode && selectedIds.size > 0 && (
          <div className="batch-bar">
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              <Tag size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
              {selectedIds.size} selected
            </span>
            <form
              style={{ display: "flex", gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                handleBatchAddTag(batchTagInput);
              }}
            >
              <input
                className="input"
                style={{ width: 220, padding: "6px 10px" }}
                value={batchTagInput}
                onChange={(e) => setBatchTagInput(e.target.value)}
                placeholder="Add tag (e.g. Character A)..."
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!batchTagInput.trim()}
              >
                Apply Tag
              </button>
            </form>
            {tags.slice(0, 5).map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="btn btn-sm"
                onClick={() => handleBatchAddTag(tag.name)}
                title={`Add "${tag.name}" to selected`}
              >
                + {tag.name}
              </button>
            ))}
            {tags.slice(0, 3).map((tag) => (
              <button
                key={`rm-${tag.id}`}
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleBatchRemoveTag(tag.name)}
                title={`Remove "${tag.name}" from selected`}
              >
                - {tag.name}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-danger btn-sm"
              style={{ marginLeft: "auto" }}
              onClick={handleBatchDelete}
            >
              <Trash2 size={13} /> Delete Selected
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={13} /> Clear
            </button>
          </div>
        )}
      </main>

      {dragActive && (
        <div className="drop-overlay">
          <Upload size={36} />
          <span>Drop images to import into ref-db</span>
        </div>
      )}

      <LightboxModal
        matches={matches}
        activeIndex={lightboxIndex}
        allTags={tags}
        onTagsUpdated={() => {
          refreshMeta();
          runSearch(filters);
        }}
        onDeleted={() => {
          setToast("Deleted reference from ref-db");
          refreshMeta();
          runSearch(filters);
        }}
        onClose={() => setLightboxIndex(null)}
        onNavigate={(nextIdx) => setLightboxIndex(nextIdx)}
      />

      <FolderManagerModal
        open={foldersModalOpen}
        indexStatus={indexStatus}
        onClose={() => setFoldersModalOpen(false)}
        onLibraryChanged={() => {
          refreshMeta();
          runSearch(filters);
        }}
      />
    </div>
  );
}

export default App;
