// Runs Cal outside Claude. Stands in for the Claude page runtime:
// "sample" calls the Anthropic API with the user's own key, everything else
// is unavailable, so the app keeps its data in this browser's localStorage.
"use strict";
window.CAL_STANDALONE = true;

(function () {
  const MODEL = "claude-opus-5-5";
  const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  let clientFor = null, client = null;

  function getKey() { try { return localStorage.getItem("cal.apikey") || "" } catch (e) { return "" } }

  async function getClient(key) {
    if (client && clientFor === key) return client;
    const { default: Anthropic } = await import("./vendor/anthropic.mjs");
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    clientFor = key;
    return client;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function fail(code, message) { const e = new Error(message); e.code = code; e.message = message; return e }

  async function sample(input, opts = {}) {
    const key = getKey();
    if (!key) throw fail("not_granted", "Add your Anthropic API key on the Targets tab to use AI.");
    const c = await getClient(key);
    const content = [];
    const imgs = opts.images ? Array.from(opts.images instanceof Blob ? [opts.images] : opts.images) : [];
    for (const img of imgs) {
      const type = IMAGE_TYPES.includes(img.type) ? img.type : "image/jpeg";
      content.push({ type: "image", source: { type: "base64", media_type: type, data: await blobToBase64(img) } });
    }
    content.push({ type: "text", text: typeof input === "string" ? input : input[input.length - 1].content });
    let res;
    try {
      res = await c.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }]
      }, { signal: opts.signal });
    } catch (e) {
      const s = e && e.status;
      if (s === 401 || s === 403) throw fail("not_granted", "Your Anthropic API key was rejected. Check it on the Targets tab.");
      if (s === 429) throw fail("rate_limited", "Too many requests just now. Wait a minute and try again.");
      if (s === 400 && /image/i.test(e.message || "")) throw fail("image_rejected", "That photo couldn't be read.");
      if (s === 400 && /credit|billing/i.test(e.message || "")) throw fail("unavailable", "Your Anthropic account is out of credit. Add credit at console.anthropic.com.");
      throw fail("unavailable", "Couldn't reach Claude. Check your connection and try again.");
    }
    if (res.stop_reason === "refusal") throw fail("refused", "Claude declined this request. Try describing it differently.");
    const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
    return { text, truncated: res.stop_reason === "max_tokens" };
  }

  sample.json = async function (input, opts) {
    const { text } = await sample(input, opts);
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw fail("bad_json", "Claude's answer wasn't in the expected format. Try again.");
    try { return JSON.parse(text.slice(start, end + 1)) }
    catch (e) { throw fail("bad_json", "Claude's answer wasn't in the expected format. Try again.") }
  };

  sample.limits = async function () {
    return { images: { maxCount: 1, maxBytes: 5 * 1024 * 1024, mediaTypes: IMAGE_TYPES } };
  };

  window.claude = {
    use: async function (name) {
      if (name === "sample") return getKey() ? sample : null;
      return null;
    }
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
