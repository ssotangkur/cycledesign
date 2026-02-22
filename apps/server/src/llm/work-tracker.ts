interface PendingWork {
  files: Map<string, { code: string; filename: string }>;
  dependencies: Set<string>;
}

const pendingWorkByMessage = new Map<string, PendingWork>();

export function trackFileCreation(messageId: string, filename: string, code: string) {
  if (!pendingWorkByMessage.has(messageId)) {
    pendingWorkByMessage.set(messageId, {
      files: new Map(),
      dependencies: new Set(),
    });
  }
  
  const work = pendingWorkByMessage.get(messageId)!;
  work.files.set(filename, { code, filename });
}

export function trackDependency(messageId: string, packageName: string) {
  if (!pendingWorkByMessage.has(messageId)) {
    pendingWorkByMessage.set(messageId, {
      files: new Map(),
      dependencies: new Set(),
    });
  }
  
  const work = pendingWorkByMessage.get(messageId)!;
  work.dependencies.add(packageName);
}

export function getPendingWork(messageId: string): PendingWork | undefined {
  return pendingWorkByMessage.get(messageId);
}

export function clearPendingWork(messageId: string) {
  pendingWorkByMessage.delete(messageId);
}
