# Nag — Walk & Water

A phone web app that reminds you to drink water and walk, and won't stop until you prove you did it.

## How it nags
- **Takeover screen** when a reminder is due. It can't be closed. It only goes away when you do the thing.
- **Gets worse over time.** Calm beeps → faster beeps after 2 min → siren, strobing and shaking after 5 min. The messages get meaner too.
- **Limited snoozes**: 5 minutes each, 2 per reminder by default (you can set 0–3). After that the snooze button is gone.
- **Repeat notifications** while the app is in the background: every 60s, then every 30s, then every 15s.
- **Tracks what you skipped**: minutes ignored, snoozes used, and your daily streak (6 glasses + 3 walks).

## How it checks you did it
- **Water:** take a photo of your full glass, then hold a button for 15 seconds while you drink. If you let go, you start over.
- **Walk:** the accelerometer counts real steps (300 by default). It only counts steps at a walking pace, so shaking the phone doesn't work. If the phone has no motion sensor, it uses GPS distance instead.

## Install on your phone
1. Host the folder over HTTPS. The easiest way is GitHub Pages: go to repo **Settings → Pages**, pick this branch and the `/ (root)` folder, then open the URL it gives you.
2. **iPhone:** in Safari, tap Share → **Add to Home Screen**, then open it from the Home Screen. iOS only allows notifications for web apps added this way.
   **Android:** in Chrome, tap ⋮ → **Install app**.
3. Open it and tap **Enable notifications & sound**.

## Limits
This is a web app, so your phone decides how much it can do in the background:
- On Chrome/Android, reminders are scheduled ahead of time (Notification Triggers) where the browser supports it.
- On iOS, background timers pause when the app is closed. The app still records when each reminder was due, so the next time you open it, it goes straight to the full alarm and shows how long you ignored it.
- Your phone's silent switch or Do Not Disturb can mute the sound.

To get a nag that can't be ignored even when the app is closed, it would need to be a native app (for example, Capacitor with local notifications) or use a push server.

No build step and no dependencies. Your data stays in your browser's localStorage.
