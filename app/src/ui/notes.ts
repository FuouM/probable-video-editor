// app/src/ui/notes.ts
// Multi-note markdown director notes editor with CodeMirror 6, line numbers,
// full undo/redo history, and screen snippet tool (Phase 5 / UI-2).

import { EditorView, lineNumbers, highlightActiveLineGutter, highlightActiveLine, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

export interface NoteItem {
  id: string; // Small random hash e.g. "a7f3"
  title: string;
  content: string;
  mtime: number;
}

export interface PlaybackContext {
  getTime: () => number;
  getClip: () => string;
  getBarBeat: () => { bar: number; beat: number };
  pause: () => void;
}

export function generateSmallHash(): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 4; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

export class NotesEditor {
  private projectId: string;
  private ctx: PlaybackContext;
  private notes: NoteItem[] = [];
  private activeNoteId: string | null = null;
  private isOpen = true;
  private isSnippetActive = false;
  private saveTimeout: number | undefined = undefined;

  // DOM elements
  private paneEl: HTMLElement;
  private selectEl: HTMLSelectElement;
  private btnNew: HTMLButtonElement;
  private btnDelete: HTMLButtonElement;
  private btnUndo: HTMLButtonElement;
  private btnRedo: HTMLButtonElement;
  private btnSnippet: HTMLButtonElement;
  private btnTime: HTMLButtonElement;
  private btnClose: HTMLButtonElement;
  private chipStatus: HTMLElement;
  private hashBadge: HTMLElement;
  private editorContainer: HTMLElement;
  private editorView: EditorView;
  private pathEl: HTMLElement;
  private statsEl: HTMLElement;

  // Snippet overlay elements
  private overlayEl: HTMLElement;
  private marqueeEl: HTMLElement;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(projectId: string, ctx: PlaybackContext) {
    this.projectId = projectId;
    this.ctx = ctx;

    // Cache elements
    this.paneEl = document.getElementById('notes-pane')!;
    this.selectEl = document.getElementById('notes-select') as HTMLSelectElement;
    this.btnNew = document.getElementById('btn-note-new') as HTMLButtonElement;
    this.btnDelete = document.getElementById('btn-note-delete') as HTMLButtonElement;
    this.btnUndo = document.getElementById('btn-note-undo') as HTMLButtonElement;
    this.btnRedo = document.getElementById('btn-note-redo') as HTMLButtonElement;
    this.btnSnippet = document.getElementById('btn-note-snippet') as HTMLButtonElement;
    this.btnTime = document.getElementById('btn-note-time') as HTMLButtonElement;
    this.btnClose = document.getElementById('btn-note-close') as HTMLButtonElement;
    this.chipStatus = document.getElementById('notes-save-chip')!;
    this.hashBadge = document.getElementById('notes-hash-badge')!;
    this.editorContainer = document.getElementById('notes-editor-container')!;
    this.pathEl = document.getElementById('notes-file-path')!;
    this.statsEl = document.getElementById('notes-stats')!;

    this.overlayEl = document.getElementById('snippet-overlay')!;
    this.marqueeEl = document.getElementById('snippet-marquee')!;

    // Initialize CodeMirror 6 with line numbers, active line highlight, history, and markdown
    this.editorView = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          markdown(),
          EditorView.lineWrapping,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.onDocChanged();
            }
            this.updateUndoRedoButtons();
          }),
        ],
      }),
      parent: this.editorContainer,
    });
    (window as unknown as { __notesEditor?: NotesEditor }).__notesEditor = this;

    this.bindEvents();
    this.loadNotes();
  }

  private bindEvents() {
    // Note selection change
    this.selectEl.addEventListener('change', () => {
      this.switchNote(this.selectEl.value);
    });

    // Create new note
    this.btnNew.addEventListener('click', () => {
      this.createNewNote();
    });

    // Delete note
    this.btnDelete.addEventListener('click', () => {
      this.deleteActiveNote();
    });

    // Undo / Redo buttons
    this.btnUndo.addEventListener('click', () => {
      undo(this.editorView);
      this.editorView.focus();
    });

    this.btnRedo.addEventListener('click', () => {
      redo(this.editorView);
      this.editorView.focus();
    });

    // Action buttons
    this.btnSnippet.addEventListener('click', () => {
      this.toggleSnippetMode();
    });

    this.btnTime.addEventListener('click', () => {
      this.insertTimecodeBlock();
    });

    this.btnClose.addEventListener('click', () => {
      this.close();
    });

    // Snippet Tool mouse interactions
    this.overlayEl.addEventListener('mousedown', (ev) => this.onSnippetMouseDown(ev));
    window.addEventListener('mousemove', (ev) => this.onSnippetMouseMove(ev));
    window.addEventListener('mouseup', (ev) => this.onSnippetMouseUp(ev));

    // Escape cancels snippet mode
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.isSnippetActive) {
        ev.preventDefault();
        this.setSnippetMode(false);
      }
    });
  }

  /** Fetch all markdown notes for the project. */
  async loadNotes() {
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(this.projectId)}/notes`);
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; notes: NoteItem[] };
      this.notes = data.notes ?? [];

      if (this.notes.length === 0) {
        // Automatically create initial note with small random hash
        await this.createNewNote(false);
      } else {
        this.renderDropdown();
        this.switchNote(this.notes[0]!.id);
      }
    } catch (e) {
      console.warn('Failed to load notes:', e);
    }
  }

  private renderDropdown() {
    this.selectEl.innerHTML = '';
    for (const note of this.notes) {
      const opt = document.createElement('option');
      opt.value = note.id;
      opt.textContent = `[#${note.id}] ${note.title || 'Untitled'}`;
      this.selectEl.appendChild(opt);
    }
    if (this.activeNoteId) {
      this.selectEl.value = this.activeNoteId;
    }
  }

  /** Switches active note. */
  private switchNote(id: string) {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return;

    this.activeNoteId = id;
    this.selectEl.value = id;
    this.hashBadge.textContent = `#${id}`;
    this.pathEl.textContent = `projects/${this.projectId}/video/notes/${id}.md`;

    // Replace CodeMirror doc content
    this.editorView.dispatch({
      changes: { from: 0, to: this.editorView.state.doc.length, insert: note.content },
    });

    this.updateStats();
    this.updateUndoRedoButtons();
    this.setSaveStatus('saved');
  }

  /** Creates a new note with a fresh small random hash. */
  async createNewNote(focus = true): Promise<string> {
    const hash = generateSmallHash();
    const initialContent = `# Note #${hash}\n\n`;
    const newNote: NoteItem = {
      id: hash,
      title: `Note #${hash}`,
      content: initialContent,
      mtime: Date.now(),
    };

    this.notes.unshift(newNote);
    this.renderDropdown();
    this.switchNote(hash);

    // Save immediately
    await this.saveNote(newNote);

    if (focus) {
      this.editorView.focus();
    }
    return hash;
  }

  /** Deletes the active note. */
  async deleteActiveNote() {
    if (!this.activeNoteId) return;
    if (this.notes.length <= 1) {
      // If deleting the last note, simply reset it
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: `# Note #${this.activeNoteId}\n\n` },
      });
      return;
    }

    const idToDelete = this.activeNoteId;
    try {
      await fetch(`/api/project/${encodeURIComponent(this.projectId)}/notes/${encodeURIComponent(idToDelete)}`, {
        method: 'DELETE',
      });
      this.notes = this.notes.filter((n) => n.id !== idToDelete);
      this.renderDropdown();
      if (this.notes.length > 0) {
        this.switchNote(this.notes[0]!.id);
      }
    } catch (e) {
      console.warn('Failed to delete note:', e);
    }
  }

  private onDocChanged() {
    this.setSaveStatus('saving');
    this.updateStats();

    if (this.activeNoteId) {
      const note = this.notes.find((n) => n.id === this.activeNoteId);
      if (note) {
        note.content = this.editorView.state.doc.toString();
        const firstLine = note.content.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
        note.title = firstLine.replace(/^#+\s*/, '') || note.id;
        const opt = this.selectEl.querySelector(`option[value="${note.id}"]`);
        if (opt) opt.textContent = `[#${note.id}] ${note.title}`;
      }
    }

    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveActiveNote();
    }, 400);
  }

  private async saveActiveNote() {
    if (!this.activeNoteId) return;
    const note = this.notes.find((n) => n.id === this.activeNoteId);
    if (!note) return;
    await this.saveNote(note);
  }

  private async saveNote(note: NoteItem) {
    this.setSaveStatus('saving');
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(this.projectId)}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: note.id, content: note.content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.setSaveStatus('saved');
    } catch {
      this.setSaveStatus('error');
    }
  }

  private setSaveStatus(status: 'saved' | 'saving' | 'error') {
    this.chipStatus.className = 'nle-chip';
    if (status === 'saved') {
      this.chipStatus.classList.add('nle-chip--ok');
      this.chipStatus.textContent = '● SAVED';
    } else if (status === 'saving') {
      this.chipStatus.classList.add('nle-chip--warn');
      this.chipStatus.textContent = '● SAVING...';
    } else {
      this.chipStatus.classList.add('nle-chip--err');
      this.chipStatus.textContent = '● ERROR';
    }
  }

  private updateStats() {
    const text = this.editorView.state.doc.toString();
    const lines = this.editorView.state.doc.lines;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    this.statsEl.textContent = `${lines}L · ${words}W · ${chars}C`;
  }

  private updateUndoRedoButtons() {
    this.btnUndo.disabled = undoDepth(this.editorView.state) === 0;
    this.btnRedo.disabled = redoDepth(this.editorView.state) === 0;
  }

  /** Inserts text at the current cursor position in CodeMirror. */
  insertText(textToInsert: string) {
    const state = this.editorView.state;
    const selection = state.selection.main;
    const currentDoc = state.doc.toString();
    const from = selection.from;
    const to = selection.to;

    const prefix = from > 0 && !currentDoc.substring(0, from).endsWith('\n\n')
      ? (currentDoc.substring(0, from).endsWith('\n') ? '\n' : '\n\n')
      : '';
    const fullText = prefix + textToInsert;

    this.editorView.dispatch({
      changes: { from, to, insert: fullText },
      selection: { anchor: from + fullText.length },
    });
    this.editorView.focus();
  }

  /** Inserts a timestamp codeblock without region. */
  insertTimecodeBlock() {
    const t = this.ctx.getTime();
    const clipId = this.ctx.getClip();
    const bb = this.ctx.getBarBeat();
    const activeHash = this.activeNoteId ?? generateSmallHash();

    const m = Math.floor(t / 60);
    const s = t % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
    const barStr = `${String(Math.max(1, Math.floor(bb.bar) + 1)).padStart(3, '0')}.${Math.floor(bb.beat % 4) + 1}`;

    const block = [
      '```pvemd',
      '{',
      `  "note": "${activeHash}",`,
      `  "time": "${timeStr}",`,
      `  "seconds": ${Number(t.toFixed(3))},`,
      `  "frame": ${Math.floor(t * 30)},`,
      `  "bar": "${barStr}",`,
      `  "clip": "${clipId}"`,
      '}',
      '```',
      '- ',
    ].join('\n');

    this.insertText(block);
  }

  // ── Screen Snippet Tool ─────────────────────────────────────────────────────

  toggleSnippetMode() {
    this.setSnippetMode(!this.isSnippetActive);
  }

  setSnippetMode(active: boolean) {
    this.isSnippetActive = active;
    if (active) {
      // Pause playback so frame stays frozen
      this.ctx.pause();
      this.overlayEl.classList.remove('hidden');
      this.btnSnippet.classList.add('active');
    } else {
      this.overlayEl.classList.add('hidden');
      this.marqueeEl.classList.add('hidden');
      this.btnSnippet.classList.remove('active');
      this.isDragging = false;
    }
  }

  private onSnippetMouseDown(ev: MouseEvent) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    this.isDragging = true;
    const rect = this.overlayEl.getBoundingClientRect();
    this.dragStartX = ev.clientX - rect.left;
    this.dragStartY = ev.clientY - rect.top;

    this.marqueeEl.style.left = `${this.dragStartX}px`;
    this.marqueeEl.style.top = `${this.dragStartY}px`;
    this.marqueeEl.style.width = '0px';
    this.marqueeEl.style.height = '0px';
    this.marqueeEl.classList.remove('hidden');
  }

  private onSnippetMouseMove(ev: MouseEvent) {
    if (!this.isDragging || !this.isSnippetActive) return;
    ev.preventDefault();
    const rect = this.overlayEl.getBoundingClientRect();
    const curX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    const curY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));

    const left = Math.min(this.dragStartX, curX);
    const top = Math.min(this.dragStartY, curY);
    const width = Math.abs(curX - this.dragStartX);
    const height = Math.abs(curY - this.dragStartY);

    this.marqueeEl.style.left = `${left}px`;
    this.marqueeEl.style.top = `${top}px`;
    this.marqueeEl.style.width = `${width}px`;
    this.marqueeEl.style.height = `${height}px`;
  }

  private onSnippetMouseUp(ev: MouseEvent) {
    if (!this.isDragging || !this.isSnippetActive) return;
    this.isDragging = false;

    const overlayRect = this.overlayEl.getBoundingClientRect();
    const curX = Math.max(0, Math.min(overlayRect.width, ev.clientX - overlayRect.left));
    const curY = Math.max(0, Math.min(overlayRect.height, ev.clientY - overlayRect.top));

    let selX = Math.min(this.dragStartX, curX);
    let selY = Math.min(this.dragStartY, curY);
    let selW = Math.abs(curX - this.dragStartX);
    let selH = Math.abs(curY - this.dragStartY);

    // If click without drag, create a default 160x90 focus box around click
    if (selW < 6 && selH < 6) {
      selW = 160;
      selH = 90;
      selX = Math.max(0, selX - selW / 2);
      selY = Math.max(0, selY - selH / 2);
    }

    // Convert DOM pixels to 1920x1080 logical frame coordinates
    const scaleX = 1920 / overlayRect.width;
    const scaleY = 1080 / overlayRect.height;

    const frameX = Math.round(selX * scaleX);
    const frameY = Math.round(selY * scaleY);
    const frameW = Math.round(selW * scaleX);
    const frameH = Math.round(selH * scaleY);

    const pctX = Number(((frameX / 1920) * 100).toFixed(1));
    const pctY = Number(((frameY / 1080) * 100).toFixed(1));
    const pctW = Number(((frameW / 1920) * 100).toFixed(1));
    const pctH = Number(((frameH / 1080) * 100).toFixed(1));

    // Current playback context
    const t = this.ctx.getTime();
    const clipId = this.ctx.getClip();
    const bb = this.ctx.getBarBeat();
    const activeHash = this.activeNoteId ?? generateSmallHash();

    const m = Math.floor(t / 60);
    const s = t % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
    const barStr = `${String(Math.max(1, Math.floor(bb.bar) + 1)).padStart(3, '0')}.${Math.floor(bb.beat % 4) + 1}`;

    const pvemdJson = {
      note: activeHash,
      time: timeStr,
      seconds: Number(t.toFixed(3)),
      frame: Math.floor(t * 30),
      bar: barStr,
      clip: clipId,
      rect: [frameX, frameY, frameW, frameH],
      pct: [pctX, pctY, pctW, pctH],
    };

    const block = ['```pvemd', JSON.stringify(pvemdJson, null, 2), '```', '- '].join('\n');

    // Deactivate snippet overlay
    this.setSnippetMode(false);

    // Make sure pane is open and insert snippet
    this.open();
    this.insertText(block);
  }

  // ── Visibility ──────────────────────────────────────────────────────────────

  open() {
    this.isOpen = true;
    this.paneEl.classList.remove('hidden');
    document.getElementById('menu-notes')?.classList.add('active');
  }

  close() {
    this.isOpen = false;
    this.paneEl.classList.add('hidden');
    this.setSnippetMode(false);
    document.getElementById('menu-notes')?.classList.remove('active');
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  get isVisible() {
    return this.isOpen;
  }
}
