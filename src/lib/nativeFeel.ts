import { isTauri } from "./native";

/** Fields and selections where the system Copy/Paste menu still belongs. */
function wantsTextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return true;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

/**
 * Removes the web view behaviours a desktop app should not have: the
 * Reload / Inspect Element menu, dragging images and links out of the window,
 * and page reload shortcuts. Holding Option keeps the inspector reachable in
 * development builds.
 */
export function installNativeBehaviour(): void {
  if (!isTauri) return;

  document.addEventListener("contextmenu", (event) => {
    if (import.meta.env.DEV && event.altKey) return;
    if (wantsTextMenu(event.target)) return;
    event.preventDefault();
  });

  document.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest("img, a, svg")) {
      event.preventDefault();
    }
  });

  if (import.meta.env.PROD) {
    document.addEventListener("keydown", (event) => {
      const reload = event.key === "F5" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r");
      if (reload) event.preventDefault();
    });
  }
}
