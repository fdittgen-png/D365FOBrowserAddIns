/**
 * Injected into the PAGE world (not isolated world) so it can wrap the real
 * History API that D365FO calls. We broadcast navigations via a CustomEvent
 * that the isolated content script listens to — content scripts cannot see
 * monkey-patches applied to page-world functions, hence this shim.
 */
(() => {
  if ((window as unknown as { __d365ReproHooked?: boolean }).__d365ReproHooked) return;
  (window as unknown as { __d365ReproHooked?: boolean }).__d365ReproHooked = true;

  const EVT = 'd365-repro:navigate';

  const dispatch = () => {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { url: location.href } }));
  };

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    const r = origPush.apply(this, args);
    queueMicrotask(dispatch);
    return r;
  };
  history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
    const r = origReplace.apply(this, args);
    queueMicrotask(dispatch);
    return r;
  };
  window.addEventListener('popstate', () => queueMicrotask(dispatch));
  window.addEventListener('hashchange', () => queueMicrotask(dispatch));
})();
