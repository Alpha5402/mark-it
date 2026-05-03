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

interface Window {
  markItWorkspace?: {
    openFolder: () => Promise<WorkspaceOpenResult | null>;
    newFolder: () => Promise<WorkspaceOpenResult | null>;
    openFile: () => Promise<MarkdownFileResult | null>;
    readFile: (filePath: string) => Promise<MarkdownFileResult>;
    writeFile: (filePath: string, content: string) => Promise<{ ok: boolean }>;
  };
  markItWindow?: {
    getState: () => Promise<{ platform: string; isFullScreen: boolean }>;
    onStateChange: (
      callback: (state: { platform: string; isFullScreen: boolean }) => void
    ) => () => void;
  };
}
