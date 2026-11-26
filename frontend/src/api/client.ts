import type {
  AppSettings,
  FolderInfo,
  HealthResponse,
  ImageDetail,
  ImportResponse,
  IndexStatus,
  LibraryStatsResponse,
  SearchRequest,
  SearchResponse,
  TagInfo,
} from "../types/api";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.detail) msg = String(parsed.detail);
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => jsonFetch<HealthResponse>("/api/health"),
  stats: () => jsonFetch<LibraryStatsResponse>("/api/stats"),
  search: (body: SearchRequest) =>
    jsonFetch<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getImageDetail: (id: number) => jsonFetch<ImageDetail>(`/api/images/${id}`),
  listFolders: () => jsonFetch<FolderInfo[]>("/api/folders"),
  pickFolder: () =>
    jsonFetch<{ folder_path: string | null }>("/api/folders/pick", {
      method: "POST",
    }),
  deleteFolder: (id: number, deleteImages = false) =>
    jsonFetch<{
      deleted: boolean;
      removed_refs: number;
      removed_thumbnails: number;
      total_indexed: number;
    }>(`/api/folders/${id}?delete_images=${deleteImages}`, { method: "DELETE" }),
  importImages: async (
    files: File[],
    sourceType: "upload" | "paste" = "upload"
  ): Promise<ImportResponse> => {
    const form = new FormData();
    form.append("source_type", sourceType);
    for (const file of files) {
      form.append("files", file, file.name || "pasted-image.png");
    }
    const res = await fetch("/api/images/import", { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Import failed (${res.status})`);
    }
    return res.json() as Promise<ImportResponse>;
  },
  deleteImage: (id: number) =>
    jsonFetch<{ deleted: boolean; total_indexed: number }>(`/api/images/${id}`, {
      method: "DELETE",
    }),
  batchDeleteImages: (imageIds: number[]) =>
    jsonFetch<{ deleted_count: number; total_indexed: number }>(
      "/api/images/batch-delete",
      {
        method: "POST",
        body: JSON.stringify({ image_ids: imageIds }),
      }
    ),
  startIndex: (folderPath: string) =>
    jsonFetch<IndexStatus>("/api/index/start", {
      method: "POST",
      body: JSON.stringify({ folder_path: folderPath }),
    }),
  cancelIndex: () => jsonFetch<IndexStatus>("/api/index/cancel", { method: "POST" }),
  getIndexStatus: () => jsonFetch<IndexStatus>("/api/index/status"),
  getSettings: () => jsonFetch<AppSettings>("/api/settings"),
  updateSettings: (imageMaxEdge: number) =>
    jsonFetch<AppSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ image_max_edge: imageMaxEdge }),
    }),
  listTags: () => jsonFetch<TagInfo[]>("/api/tags"),
  setImageTags: (imageId: number, tags: string[]) =>
    jsonFetch<TagInfo[]>(`/api/images/${imageId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),
  batchTags: (imageIds: number[], addTags: string[], removeTags: string[] = []) =>
    jsonFetch<{ updated_images: number }>("/api/tags/batch", {
      method: "POST",
      body: JSON.stringify({
        image_ids: imageIds,
        add_tags: addTags,
        remove_tags: removeTags,
      }),
    }),
  deleteTag: (tagId: number) =>
    jsonFetch<{ deleted: boolean }>(`/api/tags/${tagId}`, { method: "DELETE" }),
};
