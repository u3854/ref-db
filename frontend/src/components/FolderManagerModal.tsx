import { useEffect, useState } from "react";
import { FolderPlus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import type { AppSettings, FolderInfo, IndexStatus } from "../types/api";

interface FolderManagerModalProps {
  open: boolean;
  indexStatus: IndexStatus;
  onClose: () => void;
  onLibraryChanged: () => void;
}

export function FolderManagerModal({
  open,
  indexStatus,
  onClose,
  onLibraryChanged,
}: FolderManagerModalProps) {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folderInput, setFolderInput] = useState("");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [maxEdgeInput, setMaxEdgeInput] = useState("1920");
  const [error, setError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadData = async () => {
    try {
      const [fList, cfg] = await Promise.all([api.listFolders(), api.getSettings()]);
      setFolders(fList);
      setSettings(cfg);
      setMaxEdgeInput(String(cfg.image_max_edge));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folder data");
    }
  };

  useEffect(() => {
    if (open) loadData();
  }, [open]);

  useEffect(() => {
    if (open && !indexStatus.running && indexStatus.phase === "done") {
      loadData();
      onLibraryChanged();
    }
  }, [open, indexStatus.running, indexStatus.phase]);

  if (!open) return null;

  const handleBrowse = async () => {
    setError(null);
    try {
      const res = await api.pickFolder();
      if (res.folder_path) setFolderInput(res.folder_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Folder dialog failed");
    }
  };

  const handleStartIndex = async (targetPath: string) => {
    if (!targetPath.trim()) return;
    setError(null);
    try {
      await api.startIndex(targetPath.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start indexing");
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    setError(null);
    try {
      await api.deleteFolder(folderId);
      await loadData();
      onLibraryChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove folder");
    }
  };

  const handleSaveResize = async () => {
    setError(null);
    const parsed = Number(maxEdgeInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Max longest edge must be 0 (original) or a positive pixel value.");
      return;
    }
    setSavingSettings(true);
    try {
      const updated = await api.updateSettings(Math.round(parsed));
      setSettings(updated);
      setMaxEdgeInput(String(updated.image_max_edge));
      onLibraryChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update resize setting");
    } finally {
      setSavingSettings(false);
    }
  };

  const progressPct =
    indexStatus.total > 0
      ? Math.round((indexStatus.processed / indexStatus.total) * 100)
      : indexStatus.running
      ? 15
      : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Reference Folders & Indexing</span>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(248, 113, 113, 0.14)",
                border: "1px solid rgba(248, 113, 113, 0.35)",
                color: "var(--danger)",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* Add & Index Folder */}
          <div className="section-card">
            <div className="section-header">Scan & Index Folder</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="D:\Art\References"
              />
              <button type="button" className="btn" onClick={handleBrowse} disabled={indexStatus.running}>
                Browse
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={indexStatus.running || !folderInput.trim()}
                onClick={() => handleStartIndex(folderInput)}
              >
                <FolderPlus size={15} />
                Index
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Copies images into managed JPEG storage (<code>data/refs/</code>, capped at{" "}
              {settings?.image_max_edge ?? 1920}px longest side) and deduplicates exact +
              near-identical files. Deleting source files afterward will not remove refs from{" "}
              <code>ref-db</code>.
            </div>
          </div>

          {/* Live Index Progress */}
          {(indexStatus.running || indexStatus.phase !== "idle") && (
            <div className="section-card">
              <div className="section-header">
                <span>Indexer Status ({indexStatus.phase})</span>
                {indexStatus.running && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => api.cancelIndex()}
                    disabled={indexStatus.cancelling}
                  >
                    {indexStatus.cancelling ? "Cancelling..." : "Cancel"}
                  </button>
                )}
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-primary)" }}>{indexStatus.message}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                Added: {indexStatus.added} · Duplicates skipped: {indexStatus.skipped_unchanged} ·
                Errors: {indexStatus.errors}
              </div>
            </div>
          )}

          {/* Resize Configuration */}
          <div className="section-card">
            <div className="section-header">
              <span>Longest-Side Resize Config (Reduce-Only)</span>
              <span>Default: 1920px</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number"
                min={0}
                max={16384}
                step={64}
                className="input"
                style={{ width: 140 }}
                value={maxEdgeInput}
                onChange={(e) => setMaxEdgeInput(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setMaxEdgeInput("1920")}
              >
                1920px
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setMaxEdgeInput("0")}
              >
                Original (0)
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSaveResize}
                disabled={savingSettings}
              >
                Save
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Reduces newly imported images exceeding this longest-side pixel limit (with white
              fill for transparent PNGs) while keeping aspect ratio. Smaller images are never
              upscaled.
            </div>
            {settings && (
              <div className="mono" style={{ color: "var(--text-muted)" }}>
                Model cache: {settings.models_dir}
              </div>
            )}
          </div>

          {/* Indexed Folders List */}
          <div className="section-card">
            <div className="section-header">Indexed Folders ({folders.length})</div>
            {folders.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                No folders indexed yet.
              </div>
            ) : (
              folders.map((folder) => (
                <div key={folder.id} className="folder-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-primary)" }}>
                      {folder.path}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                      {folder.image_count} images
                      {folder.last_indexed_at
                        ? ` · Last scanned ${new Date(folder.last_indexed_at * 1000).toLocaleString()}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={indexStatus.running}
                    onClick={() => handleStartIndex(folder.path)}
                    title="Re-scan folder"
                  >
                    <RefreshCw size={13} />
                    Re-scan
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={indexStatus.running}
                    onClick={() => handleDeleteFolder(folder.id)}
                    title="Unlink folder shortcut (keeps imported refs safely in ref-db)"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
