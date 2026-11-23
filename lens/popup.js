// Réglage du serveur Vigil (par défaut : le site en ligne ; en local : http://localhost:3100)
const DEFAULT_API = "https://vigil-eight-ecru.vercel.app";
const input = document.getElementById("api");
const site = document.getElementById("site");
chrome.storage.local.get("api").then(({ api }) => {
  input.value = api || DEFAULT_API;
  site.href = input.value;
});
input.addEventListener("change", () => {
  const v = input.value.trim().replace(/\/+$/, "") || DEFAULT_API;
  chrome.storage.local.set({ api: v });
  site.href = v;
});
