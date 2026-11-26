export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
  cx: number;
  cy: number;
  size: number;
}

export interface TorsoPose {
  yaw: number;
  lean: number;
  cx: number;
  cy: number;
  span: number;
}

export interface SubjectPose {
  head: HeadPose | null;
  torso: TorsoPose | null;
}

export interface PosesPayload {
  heads: HeadPose[];
  torsos: TorsoPose[];
  subjects: SubjectPose[];
}

export interface TagInfo {
  id: number;
  name: string;
  color: string;
  image_count?: number;
}

export interface SearchRequest {
  query: string;
  similar_to_image_id?: number | null;
  folder_id: number | null;
  tag_ids: number[];
  tag_mode: "all" | "any";
  use_head_yaw: boolean;
  head_yaw: number;
  use_head_pitch: boolean;
  head_pitch: number;
  head_tol: number;
  head_presence?: "any" | "require" | "exclude";
  use_torso_yaw: boolean;
  torso_yaw: number;
  use_torso_lean: boolean;
  torso_lean: number;
  torso_tol: number;
  torso_presence?: "any" | "require" | "exclude";
  match_mode: "paired" | "independent";
  top_k: number;
}

export interface SearchMatch {
  id: number;
  folder_id: number | null;
  path: string;
  filename: string;
  width: number;
  height: number;
  score: number;
  pose_score: number;
  thumb_url: string;
  file_url: string;
  poses: PosesPayload;
  tags: TagInfo[];
  source_type?: string;
}

export interface SearchResponse {
  matches: SearchMatch[];
  total_matches: intLike;
  total_indexed: number;
  elapsed_ms: number;
}

type intLike = number;

export interface ImageDetail {
  id: number;
  folder_id: number | null;
  path: string;
  filename: string;
  mtime: number;
  size_bytes: number;
  width: number;
  height: number;
  indexed_at: number;
  thumb_url: string;
  file_url: string;
  poses: PosesPayload;
  tags: TagInfo[];
  source_type?: string;
  content_hash?: string | null;
}

export interface ImportResponse {
  imported: ImageDetail[];
  skipped_duplicates: number;
  errors: number;
}

export interface FolderInfo {
  id: number;
  path: string;
  last_indexed_at: number | null;
  created_at: number;
  image_count: number;
}

export interface IndexStatus {
  running: boolean;
  cancelling: boolean;
  folder_path: string | null;
  phase: string;
  processed: number;
  total: number;
  added: number;
  updated: number;
  skipped_unchanged: number;
  pruned: number;
  errors: number;
  current_file: string | null;
  message: string;
}

export interface AppSettings {
  image_max_edge: number;
  thumb_max_size: number;
  pose_max_edge: number;
  embed_batch_size: number;
  models_dir: string;
  data_dir: string;
}

export interface HealthResponse {
  status: string;
  device: string;
  dtype: string;
  model_loaded: boolean;
  gpu_name: string | null;
  vram_total_mb: number | null;
  total_images: number;
  total_folders: number;
  image_max_edge: number;
}

export interface LibraryStatsResponse {
  total_images: number;
  total_folders: number;
  total_tags: number;
  images_with_head: number;
  images_with_torso: number;
  images_with_both: number;
  untagged_images: number;
  folder_source_count: number;
  direct_import_count: number;
  storage_bytes: number;
}
