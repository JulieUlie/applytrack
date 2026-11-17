// Accessible tabs (WAI-ARIA tabs pattern): click or arrow keys; the open tab is kept in the URL hash.
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false, remember = true) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
    if (remember) history.replaceState(null, "", `#${tab.id.replace(/^tab-/, "")}`);
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length], true); }
      if (e.key === "Home") { e.preventDefault(); select(tabs[0], true); }
      if (e.key === "End") { e.preventDefault(); select(tabs[tabs.length - 1], true); }
    });
  });
  select(tabs.find((t) => `#${t.id.replace(/^tab-/, "")}` === location.hash) || tabs[0], false, false);
}
