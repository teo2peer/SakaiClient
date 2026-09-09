import type { SakaiResource, SyncedDocument } from '@/types/sakai';
import { resourceFingerprint } from '@/lib/paths';

export type ResourceTreeNode = {
  path: string;
  name: string;
  isFolder: boolean;
  children: ResourceTreeNode[];
  resource?: SakaiResource;
  document?: SyncedDocument;
  localOnly?: boolean;
  totalFiles: number;
  downloadedFiles: number;
  currentFiles: number;
};

export function buildResourceTree(
  resources: SakaiResource[],
  documents: SyncedDocument[],
): ResourceTreeNode[] {
  const roots: ResourceTreeNode[] = [];
  const folders = new Map<string, ResourceTreeNode>();
  const files = new Set<string>();
  const localFiles = new Map(documents.map((document) => [document.remotePath, document]));
  const remotePaths = new Set(resources.map((resource) => resource.remotePath));

  for (const resource of [...resources, ...documents.filter((document) => !remotePaths.has(document.remotePath))]) {
    const segments = resource.remotePath.split('/').filter(Boolean);
    if (!segments.length) continue;
    let siblings = roots;
    const folderCount = resource.isFolder ? segments.length : segments.length - 1;
    for (let index = 0; index < folderCount; index += 1) {
      const path = segments.slice(0, index + 1).join('/');
      let folder = folders.get(path);
      if (!folder) {
        folder = { path, name: segments[index], isFolder: true, children: [], totalFiles: 0, downloadedFiles: 0, currentFiles: 0 };
        folders.set(path, folder);
        siblings.push(folder);
      }
      if (resource.isFolder && index === folderCount - 1) folder.name = resource.name;
      siblings = folder.children;
    }
    if (!resource.isFolder && !files.has(resource.remotePath)) {
      files.add(resource.remotePath);
      const document = localFiles.get(resource.remotePath);
      const physicallyAvailable = Boolean(document?.localUri && document.available === true);
      siblings.push({
        path: resource.remotePath,
        name: resource.name,
        isFolder: false,
        children: [],
        resource,
        document,
        localOnly: !remotePaths.has(resource.remotePath),
        totalFiles: 1,
        downloadedFiles: physicallyAvailable ? 1 : 0,
        currentFiles: physicallyAvailable && document?.fingerprint === resourceFingerprint(resource) ? 1 : 0,
      });
    }
  }
  const countDownloads = (children: ResourceTreeNode[]) => {
    for (const node of children) {
      if (!node.isFolder) continue;
      countDownloads(node.children);
      node.totalFiles = node.children.reduce((sum, child) => sum + child.totalFiles, 0);
      node.downloadedFiles = node.children.reduce((sum, child) => sum + child.downloadedFiles, 0);
      node.currentFiles = node.children.reduce((sum, child) => sum + child.currentFiles, 0);
    }
  };
  countDownloads(roots);
  return roots;
}

export function resourceTreeSummary(tree: ResourceTreeNode[]): { downloaded: number; total: number } {
  return tree.reduce((summary, node) => ({
    downloaded: summary.downloaded + node.downloadedFiles,
    total: summary.total + node.totalFiles,
  }), { downloaded: 0, total: 0 });
}

export function visibleResourceRows(
  tree: ResourceTreeNode[],
  expanded: Set<string>,
): { node: ResourceTreeNode; depth: number }[] {
  const rows: { node: ResourceTreeNode; depth: number }[] = [];
  const visit = (nodes: ResourceTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.isFolder && expanded.has(node.path)) visit(node.children, depth + 1);
    }
  };
  visit(tree, 0);
  return rows;
}
