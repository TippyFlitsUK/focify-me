// Simulates a hydrated framework: re-fetches data from a cross-origin API
// after load and replaces the server-rendered content with it.
fetch("__API_ORIGIN__/api/data.json").then(r => r.json()).then(d => {
  const el = document.getElementById("hydrated");
  if (el) el.textContent = "hydrated:" + d.items.join(",");
});
