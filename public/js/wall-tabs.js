// The tabs at the top of every page are what the wall shows (server.js
// setWallMode): picking one switches the wall for everyone, and every open
// page follows to the tab that's on the wall.
(function () {
  const PAGES = { cues: '/control', visuals: '/visuals', grid: '/grid' };
  const nav = document.getElementById('wallTabs');
  const page = nav.dataset.page;

  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('a[data-mode]');
    if (!tab) return;
    e.preventDefault();
    if (tab.dataset.mode === page) return;
    fetch('/api/wall', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: tab.dataset.mode }),
    }).then((res) => {
      if (res.ok) location.href = tab.href;
    }).catch(() => {});
  });

  // Called with backdrop's state.wallMode on every update
  window.wallTabs = {
    follow(mode) {
      if (PAGES[mode] && mode !== page) location.replace(PAGES[mode]);
    },
  };
})();
