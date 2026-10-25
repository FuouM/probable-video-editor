// Agent Scene Change Detector for pve-next NLE
// Listens to Vite HMR WebSocket and queries git status to track modified / reloaded clips.

export interface SceneStatusData {
  projectId: string;
  dirtyClips: string[];
  modifiedFiles: string[];
  timestamp: number;
}

export class AgentChangeDetector {
  private dirtyClips = new Set<string>();
  private reloadedClips = new Map<string, number>();
  private sceneToClips = new Map<string, string[]>();
  private listeners: ((dirty: Set<string>, reloaded: Map<string, number>, files: string[]) => void)[] = [];
  private lastFiles: string[] = [];

  constructor(private projectId: string) {
    this.pollInitial();
    this.attachHmr();
  }

  onChange(fn: (dirty: Set<string>, reloaded: Map<string, number>, files: string[]) => void) {
    this.listeners.push(fn);
  }
  setClipScenes(clips: Array<{ id: string; scene?: string }>) {
    this.sceneToClips.clear();
    for (const c of clips) {
      if (!c.scene) continue;
      const list = this.sceneToClips.get(c.scene) ?? [];
      list.push(c.id);
      this.sceneToClips.set(c.scene, list);
    }
  }


  private notify() {
    for (const fn of this.listeners) fn(this.dirtyClips, this.reloadedClips, this.lastFiles);
  }

  private async pollInitial() {
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(this.projectId)}/status`);
      if (res.ok) {
        const data: SceneStatusData = await res.json();
        this.updateStatus(data);
      }
    } catch {
      // Offline / export mode
    }
  }

  private updateStatus(data: SceneStatusData) {
    const dirty = new Set<string>();
    for (const sc of data.dirtyClips) {
      dirty.add(sc);
      const mapped = this.sceneToClips.get(sc);
      if (mapped) for (const cid of mapped) dirty.add(cid);
    }
    this.dirtyClips = dirty;
    this.lastFiles = data.modifiedFiles;
    this.notify();
  }

  markReloaded(clipOrSceneId: string) {
    const ids = [clipOrSceneId, ...(this.sceneToClips.get(clipOrSceneId) ?? [])];
    const now = performance.now();
    for (const id of ids) this.reloadedClips.set(id, now);
    this.notify();
    setTimeout(() => {
      for (const id of ids) this.reloadedClips.delete(id);
      this.notify();
    }, 3200);
  }

  private attachHmr() {
    if (import.meta.hot) {
      import.meta.hot.on('pve:scene-status', (data: SceneStatusData) => {
        if (data.projectId === this.projectId) {
          this.updateStatus(data);
        }
      });
    }
  }
}
