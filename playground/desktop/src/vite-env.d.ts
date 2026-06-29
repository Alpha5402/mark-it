/// <reference types="vite/client" />

type WorkspaceTreeNode = {
  type: 'directory' | 'file';
  name: string;
  path: string;
  children?: WorkspaceTreeNode[];
};

type WorkspaceOpenResult = {
  rootPath: string;
  rootName: string;
  tree: WorkspaceTreeNode;
};

type MarkdownFileResult = {
  path: string;
  name: string;
  content: string;
};

type PersistedTabSession = {
  id: string;
  path: string | null;
  name: string;
  content: string;
  isDirty: boolean;
};

type PersistedSessionState = {
  tabs: PersistedTabSession[];
  activeTabId: string | null;
};

type CreateMarkdownFileResult = {
  ok: boolean;
  file?: MarkdownFileResult;
  workspace?: WorkspaceOpenResult | null;
};

type CreateDirectoryResult = {
  ok: boolean;
  path?: string;
  workspace?: WorkspaceOpenResult | null;
};

interface Window {
  markItWorkspace?: {
    openFolder: () => Promise<WorkspaceOpenResult | null>;
    newFolder: () => Promise<WorkspaceOpenResult | null>;
    restoreLastFolder: () => Promise<WorkspaceOpenResult | null>;
    saveSession: (payload: PersistedSessionState) => Promise<{ ok: boolean }>;
    restoreSession: () => Promise<PersistedSessionState>;
    setDirtyState: (hasDirtyTabs: boolean) => void;
    openFile: () => Promise<MarkdownFileResult | null>;
    readFile: (filePath: string) => Promise<MarkdownFileResult>;
    writeFile: (filePath: string, content: string) => Promise<{ ok: boolean }>;
    createMarkdownFile: (targetPath: string) => Promise<CreateMarkdownFileResult>;
    createDirectory: (targetPath: string) => Promise<CreateDirectoryResult>;
    revealPath: (targetPath: string) => Promise<{ ok: boolean }>;
  };
  markItWindow?: {
    getState: () => Promise<{ platform: string; isFullScreen: boolean }>;
    onStateChange: (
      callback: (state: { platform: string; isFullScreen: boolean }) => void
    ) => () => void;
  };
}
