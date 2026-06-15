import { EventRef } from "obsidian";

type Cleanup = () => void;

export class LifecycleScope {
    private cleanups: Cleanup[] = [];
    private disposed = false;
    private generation = 0;

    get isDisposed() {
        return this.disposed;
    }

    reset() {
        this.dispose();
        this.cleanups = [];
        this.disposed = false;
        this.generation++;
    }

    token() {
        return this.generation;
    }

    isCurrent(token: number) {
        return !this.disposed && token === this.generation;
    }

    add(cleanup: Cleanup) {
        if (this.disposed) {
            cleanup();
            return;
        }
        this.cleanups.push(cleanup);
    }

    setTimer(callback: () => void, delay: number) {
        if (this.disposed) return null;
        let timer: number | null = window.setTimeout(() => {
            timer = null;
            if (!this.disposed) callback();
        }, delay);
        this.add(() => {
            if (timer !== null) {
                window.clearTimeout(timer);
                timer = null;
            }
        });
        return timer;
    }

    observe(observer: MutationObserver, target: Node, options: MutationObserverInit) {
        if (this.disposed) return;
        observer.observe(target, options);
        this.add(() => observer.disconnect());
    }

    event(owner: { offref(ref: EventRef): void }, ref: EventRef) {
        this.add(() => owner.offref(ref));
    }

    dom<K extends keyof DocumentEventMap>(
        target: Document,
        type: K,
        listener: (this: Document, ev: DocumentEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions
    ): void;
    dom<K extends keyof WindowEventMap>(
        target: Window,
        type: K,
        listener: (this: Window, ev: WindowEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions
    ): void;
    dom<K extends keyof HTMLElementEventMap>(
        target: HTMLElement,
        type: K,
        listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions
    ): void;
    dom(
        target: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ) {
        if (this.disposed) return;
        target.addEventListener(type, listener, options);
        this.add(() => target.removeEventListener(type, listener, options));
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        const cleanups = this.cleanups.splice(0).reverse();
        cleanups.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.error("Assistant: lifecycle cleanup failed", e);
            }
        });
    }
}
