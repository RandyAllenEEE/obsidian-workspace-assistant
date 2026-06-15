import { StatusBarManager } from "./manager";

export default class Spooler {
    plugin: StatusBarManager;
    mutex: boolean;
    spooler: number;
    observer: MutationObserver;
    callback: (plugin: StatusBarManager) => void;
    private disposed = false;

    constructor(plugin: StatusBarManager, callback: (plugin: StatusBarManager) => void) {
        // Technically the mutex part is not necessary, since JavaScript
        // is single-threaded, but this way it's future-proof.
        this.plugin = plugin;
        this.mutex = false;
        this.spooler = 0;
        this.callback = callback;

        this.observer = new MutationObserver((list, _) => {
            if (
                !this.mutex
                && list.some(
                    mutation => mutation.type == "childList"
                        && mutation.addedNodes.length > 0
                )
            ) {
                this.spoolFix(0);
            }
        });

        this.spoolFix(0); // In case of issues, try increasing this again.
    }

    /**
     * Disable automatic spooling.
     */
    disableObserver() {
        this.observer.disconnect();
    }

    /**
     * Enable automatic spooling.
     */
    enableObserver() {
        if (this.disposed || !this.plugin.statusBar) return;
        this.observer.observe(this.plugin.statusBar!, { childList: true });
    }

    dispose() {
        this.disposed = true;
        window.clearTimeout(this.spooler);
        this.disableObserver();
    }

    /**
     * Schedule status bar elements to be reordered.
     * 
     * @param timeout 
     */
    spoolFix(timeout: number = 1000) {
        if (this.disposed) return;
        clearTimeout(this.spooler);

        this.spooler =
            window.setTimeout(() => {
                if (this.disposed) return;
                if (this.mutex) {
                    this.spoolFix();
                } else {
                    this.mutex = true;
                    this.disableObserver();

                    try {
                        this.callback(this.plugin);
                    } catch (e) {
                        console.error("Assistant: status bar reorder failed", e);
                    } finally {
                        this.mutex = false;
                        if (!this.disposed) this.enableObserver();
                    }
                }
            }, timeout);
    }
}
