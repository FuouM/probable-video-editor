// The help for a file that did not load is the inline script of index.html (pveLoadFailure), because a script of the
// page can fail before any module runs. This module types it for boot.ts and player.ts.

declare global {
  interface Window {
    /**
     * A file of the video did not load. Tells a new deploy of the site or an error answer of the server (the page
     * reloads once, then shows #reload) from a request that got no answer (the help about blockers, #blocked).
     * `urls`: the files that failed, when the error names them.
     */
    pveLoadFailure(urls: string[]): Promise<void>;
    /** The video is ready: the next failure can reload the page by itself again. */
    pveLoadDone(): void;
  }
}

/**
 * The text of an error when a file did not download. It differs by browser: a refused request, a module that did not
 * load, a font (a DOMException NetworkError), an error answer (audio.ts names the HTTP status), or a failed image or
 * media load (no text, only its event).
 */
export const DOWNLOAD = /Failed to fetch|NetworkError|network error|Load failed|dynamically imported module|Importing a module script failed|ERR_BLOCKED|HTTP [45]\d\d|\[object (Progress)?Event\]/i;

/** The URL in the first line of an error (the message): Chrome and Firefox name the module that did not load, Safari does not. */
export function failedUrls(error: string): string[] {
  const m = /https?:\/\/\S+/.exec(error.split('\n')[0]!);
  return m ? [m[0]] : [];
}
