/** pywebview native bridge — exposes window.dshare for host.js */
(function () {
  function waitApi() {
    return new Promise((resolve) => {
      if (window.pywebview?.api) return resolve(window.pywebview.api);
      window.addEventListener('pywebviewready', () => resolve(window.pywebview?.api));
      setTimeout(() => resolve(window.pywebview?.api || null), 4000);
    });
  }

  waitApi().then((api) => {
    if (!api) return;
    window.dshare = {
      platform: 'windows',
      isNativeHost: true,
      discoverClients() {
        return api.discover_clients();
      },
      injectControl(msg) {
        return api.inject_control(msg);
      },
    };
    window.dispatchEvent(new Event('dshare-ready'));
  });
})();
