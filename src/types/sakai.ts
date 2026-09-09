import type { ColorSchemePreference, PaletteId } from '@/constants/palettes';

export type SakaiSession = {
  id: string;
  userEid: string;
  userId: string;
};

export type SakaiCourse = {
  id: string;
  title: string;
  description: string;
  term?: string;
};

export type CoursePreference = {
  alias?: string;
  favorite?: boolean;
};

export type SakaiAnnouncement = {
  id: string;
  courseId?: string;
  courseTitle: string;
  title: string;
  body: string;
  author: string;
  createdAt?: string;
  attachments: {
    name: string;
    url: string;
  }[];
};

export type SakaiResource = {
  id: string;
  courseId: string;
  name: string;
  remotePath: string;
  downloadUrl: string;
  contentType?: string;
  size?: number;
  modifiedAt?: string;
  isFolder?: boolean;
};

export type SyncedDocument = SakaiResource & {
  localUri: string;
  syncedAt: string;
  fingerprint: string;
  available?: boolean;
  localUriTrusted?: boolean;
};

export type SyncProgress = {
  courseId?: string;
  courseTitle?: string;
  current: number;
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  timedOut: number;
  fileProgress?: number;
  fileBytesReceived?: number;
  fileBytesTotal?: number;
  completedBytes?: number;
  totalBytes?: number;
  currentPath?: string;
};

export type SyncResult = SyncProgress & {
  documents: Record<string, SyncedDocument>;
  resourcesByCourse: Record<string, SakaiResource[]>;
  finishedAt: string;
  errors: string[];
  cancelled: boolean;
};

export type DownloadScope =
  | { type: 'all' }
  | { type: 'course'; courseId: string }
  | { type: 'folder'; courseId: string; path: string }
  | { type: 'file'; courseId: string; resource: SakaiResource; force?: boolean };

export type FolderNavigationMode = 'expandable' | 'screen';

export type AppSettings = {
  notifications: boolean;
  syncRootUri?: string;
  syncRootName?: string;
  downloadLocationChosen?: boolean;
  palette?: PaletteId;
  colorScheme?: ColorSchemePreference;
  folderNavigationMode: FolderNavigationMode;
};

export type AppData = {
  version: 3;
  courses: SakaiCourse[];
  courseOrder: string[];
  coursePreferences: Record<string, CoursePreference>;
  announcements: SakaiAnnouncement[];
  readAnnouncementIds: string[];
  documents: Record<string, SyncedDocument>;
  resourcesByCourse: Record<string, SakaiResource[]>;
  settings: AppSettings;
  lastRefreshAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
};

export type SavedCredentials = {
  username: string;
  password: string;
};
