import type { SakaiCourse, SakaiResource } from '@/types/sakai';

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizePathSegment(value: string, fallback = 'Sin nombre'): string {
  const clean = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);

  if (!clean) return fallback;
  return RESERVED_NAMES.test(clean) || clean.startsWith('.') ? `_${clean}` : clean;
}

export function resourcePathSegments(resource: SakaiResource): string[] {
  const parts = resource.remotePath
    .split('/')
    .filter(Boolean)
    .map((part) => sanitizePathSegment(part));

  if (parts.length === 0) return [sanitizePathSegment(resource.name, 'documento')];
  parts[parts.length - 1] = sanitizePathSegment(resource.name || parts[parts.length - 1]);
  return parts;
}

export function resourcePathPlan(resources: SakaiResource[]): Map<SakaiResource, string[]> {
  const plan = new Map(resources.map((resource) => [resource, resourcePathSegments(resource)]));
  const rawPaths = new Map(resources.map((resource) => [resource, resource.remotePath.split('/').filter(Boolean)]));
  const maxFolders = Math.max(0, ...[...plan.values()].map((segments) => segments.length - 1));
  for (let depth = 0; depth < maxFolders; depth += 1) {
    const folderCollisions = new Map<string, SakaiResource[]>();
    for (const [resource, segments] of plan) {
      if (depth >= segments.length - 1) continue;
      const key = segments.slice(0, depth + 1).map(portablePathKey).join('/');
      const group = folderCollisions.get(key) ?? [];
      group.push(resource);
      folderCollisions.set(key, group);
    }
    for (const group of folderCollisions.values()) {
      const prefixes = [...new Set(group.map((resource) => rawPaths.get(resource)!.slice(0, depth + 1).join('/').normalize('NFC')))].sort((left, right) => left.localeCompare(right, 'en'));
      if (prefixes.length < 2) continue;
      for (const resource of group) {
        const prefix = rawPaths.get(resource)!.slice(0, depth + 1).join('/').normalize('NFC');
        const segments = plan.get(resource)!;
        segments[depth] = suffixedSegment(segments[depth], `${shortHash(prefix)}-${prefixes.indexOf(prefix) + 1}`);
      }
    }
  }
  const collisions = new Map<string, SakaiResource[]>();
  for (const [resource, segments] of plan) {
    const key = segments.map(portablePathKey).join('/');
    const group = collisions.get(key) ?? [];
    group.push(resource);
    collisions.set(key, group);
  }
  for (const group of collisions.values()) {
    const identities = [...new Set(group.map((resource) => `${resource.remotePath}\0${resource.id}`))]
      .sort((left, right) => left.localeCompare(right, 'en'));
    if (identities.length < 2) continue;
    for (const resource of group) {
      const identity = `${resource.remotePath}\0${resource.id}`;
      const index = identities.indexOf(identity);
      const segments = plan.get(resource)!;
      segments[segments.length - 1] = suffixedFileName(segments.at(-1)!, `${shortHash(identity)}-${index + 1}`);
    }
  }
  return plan;
}

export function courseFolderName(course: SakaiCourse, courses: SakaiCourse[]): string {
  const title = sanitizePathSegment(course.title, 'Asignatura');
  const duplicates = courses.filter(
    (candidate) => portablePathKey(sanitizePathSegment(candidate.title, 'Asignatura')) === portablePathKey(title),
  );
  return duplicates.length > 1 ? `${title} (${shortId(course.id)})` : title;
}

export function resourceFingerprint(resource: SakaiResource): string {
  return [resource.modifiedAt ?? '', resource.size ?? '', resource.downloadUrl].join('|');
}

function shortId(value: string): string {
  const prefix = sanitizePathSegment(value).slice(0, 8);
  return `${prefix}-${shortHash(value)}`;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function portablePathKey(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}

function suffixedFileName(value: string, suffix: string): string {
  const dot = value.lastIndexOf('.');
  const extension = dot > 0 && value.length - dot <= 17 ? value.slice(dot) : '';
  const stem = extension ? value.slice(0, dot) : value;
  const marker = ` (${suffix})`;
  return `${stem.slice(0, Math.max(1, 120 - marker.length - extension.length))}${marker}${extension}`;
}

function suffixedSegment(value: string, suffix: string): string {
  const marker = ` (${suffix})`;
  return `${value.slice(0, Math.max(1, 120 - marker.length))}${marker}`;
}
