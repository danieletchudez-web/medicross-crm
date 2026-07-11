/**
 * Sidebar hover-expand position test.
 * Paste this in the browser console while on any page with the collapsed sidebar.
 *
 * Usage:
 *   1. Make sure the sidebar is in collapsed mode (rail, 72px).
 *   2. Open browser DevTools console.
 *   3. Paste and run this script.
 *   4. The script forces sidebar--expanded, measures positions, then reverts.
 *   5. Results are logged in a table — all diffs should be ≤ 2px.
 */
(function verifySidebarPositions() {
  const sidebar = document.querySelector('.sidebar--collapsed');
  if (!sidebar) {
    console.warn('[SidebarTest] sidebar--collapsed not found. Is the sidebar collapsed?');
    return;
  }

  const items = [...document.querySelectorAll('.sidebar-nav__item')];
  if (!items.length) {
    console.warn('[SidebarTest] No .sidebar-nav__item elements found.');
    return;
  }

  // Snapshot collapsed positions
  const collapsed = items.map(el => ({
    label: el.querySelector('.sidebar-nav__label')?.textContent?.trim() || '(no label)',
    top: Math.round(el.getBoundingClientRect().top),
  }));

  // Force expanded state (same as JS hover-intent does)
  sidebar.classList.add('sidebar--expanded');

  // Wait one frame for layout to apply
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const expanded = items.map(el => Math.round(el.getBoundingClientRect().top));

      // Revert
      sidebar.classList.remove('sidebar--expanded');

      // Report
      const rows = collapsed.map((c, i) => ({
        'Item': c.label,
        'Top (collapsed)': c.top,
        'Top (expanded)': expanded[i],
        'Diff (px)': expanded[i] - c.top,
        'OK?': Math.abs(expanded[i] - c.top) <= 2 ? '✅' : '❌ FAIL',
      }));

      console.table(rows);

      const maxDiff = Math.max(...rows.map(r => Math.abs(r['Diff (px)'])));
      if (maxDiff <= 2) {
        console.log(`✅ All items within tolerance (max diff: ${maxDiff}px)`);
      } else {
        console.error(`❌ Max diff = ${maxDiff}px — some items still shift beyond 2px tolerance`);
      }
    });
  });
})();
