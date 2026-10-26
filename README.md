# Cal — macro coach

A phone web app that works out your daily calories and macros, tracks meals, keeps your own foods and recipes, and builds a weekly menu from the foods you like.

- **Targets**: BMR with Mifflin-St Jeor, TDEE from your activity level, calorie target for your goal, and protein/fat/carbs checked with the 4-4-9 rule. Add body fat % to base protein on lean mass, or enter your dietitian's numbers to use those instead.
- **Today**: describe a meal or take a photo, Claude estimates it, you check the numbers, and it's added to a running total against your targets.
- **My foods**: save foods and recipes with exact numbers (from a label or built from ingredients) so they're logged without guessing.
- **Menu**: a food questionnaire (likes, dislikes, cuisines, cooking time, your dietitian's menu) builds a 7-day menu sized to your targets.

## Install on your phone
1. Turn on GitHub Pages: repo **Settings → Pages**, source **Deploy from a branch**, pick this branch and the `/ (root)` folder. GitHub shows the address, e.g. `https://<user>.github.io/claude-on-phone/`.
2. Open that address on your phone.
   - **iPhone**: in Safari, tap Share → **Add to Home Screen**.
   - **Android**: in Chrome, tap ⋮ → **Install app** (or **Add to Home screen**).
3. Open Cal from the home screen and answer the setup questions.

## AI features (meal estimates, photos, menus)
Outside Claude, Cal calls Claude with your own Anthropic API key:
1. Create a key at [console.anthropic.com](https://console.anthropic.com) → API keys, and add some credit.
2. In Cal, open **Targets → AI features**, paste the key, and tap **Turn on AI**.

The key is stored only in your phone's browser and sent only to Anthropic. Calls use Claude Opus 5.5 and are billed to your Anthropic account. Everything else (targets, saved foods, logging) works without a key.

## Your data
The installed app keeps everything in your phone's browser storage. It is separate from the Claude artifact version, and clearing the browser's site data erases it.

## Editing
`src/cal.html` is the app (it's also the Claude artifact). After changing it, run `python3 build.py` to regenerate `index.html`. `standalone.js` connects the app to the Anthropic API when it runs outside Claude; `vendor/anthropic.mjs` is the Anthropic TypeScript SDK 0.133.0 bundled for the browser.
