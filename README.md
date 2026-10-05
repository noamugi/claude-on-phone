# Nag — Walk & Water

A phone web app that reminds you to drink water and walk, and won't stop until you prove you did it.

## How it nags
- **Takeover screen** when a reminder is due. It can't be closed. It only goes away when you do the thing.
- **Gets worse over time.** Calm beeps, then faster beeps after 2 min, then a siren with strobing and shaking after 5 min. The messages get meaner too.
- **Limited snoozes**: 5 minutes each, 2 per reminder by default (you can set 0–3). After that the snooze button is gone.
- **Daily goals with pacing**: a water goal in ml (default 2,000) and a step goal (default 10,000). If you fall behind pace for the time of day, reminders come more often and walks get longer (10–30 min, sized to close the gap). Once a goal is met, that reminder stops for the day.
- **Tracks what you skipped**: minutes ignored, snoozes used, and your daily streak (both goals met).

## Quiet mode
For meetings (30 min, 1 hour, 2 hours) or sleep (until your wake-up time). Reminders that come due wait until it ends and then start fresh. You can turn it on from the home screen or straight from an alarm. Outside your awake hours it's always quiet.

## How it checks you did it
- **Water:** film yourself drinking (at least 5 seconds, because the bottle isn't see-through), then tap how much you drank: ¼, ½, ¾ or a whole bottle. Set your bottle size in Settings.
- **Walk:** a timed walk with random "still walking?" check-ins. Miss one (15 seconds to tap) and the walk starts over. Then enter today's step count from your phone's health app, with a screenshot. The number has to be higher than last time.
- You can also log steps from the home screen any time (number + screenshot).

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
