# Pligter & Lommepenge – web version

The same app as `lommepenge/` (Android), as an installable web app for iPhones and anything else with a browser.
Both apps share one family through a Firebase Realtime Database, so a chore ticked off on an iPhone shows up for
approval on an Android phone straight away.

No build step: `index.html` loads `app.js` (Preact + htm, vendored in `vendor/`). GitHub Actions publishes this
folder to GitHub Pages (`.github/workflows/pages.yml`) from the default branch.

## Setting up the online database

1. In the [Firebase console](https://console.firebase.google.com) create a project (Analytics not needed).
2. **Build → Realtime Database → Create database**, location *Belgium (europe-west1)*, start in **locked mode**.
3. On the **Rules** tab paste the rules below and press **Publish**.
4. Copy the database URL from the **Data** tab (`https://….firebasedatabase.app`) into `DATABASE_URL` in both
   `web/config.js` and `lommepenge/src/main/java/com/baldissera/lommepenge/Config.kt`.
5. In the GitHub repository: **Settings → Pages → Source: GitHub Actions**.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "families": {
      "$family": {
        ".read": "$family.length >= 16",
        ".write": "$family.length >= 16"
      }
    }
  }
}
```

Nobody can list the families; a family can only be opened with its 20-character random code, which acts as the
password. The parents' PIN keeps the kids out of the parent area.

## Data

Everything for one family lives under `families/<code>`. Money is in øre. Both apps must follow these rules exactly.

| Path | Value |
| --- | --- |
| `settings` | `{ pin, pinChanged, approval }` |
| `kids/<id>` | `{ name, avatar, color, weekly, goalName, goalEmoji, goalAmount, since, order }` – weekly allowance is paid for each Monday after `since` (`YYYY-MM-DD`) |
| `chores/<id>` | `{ title, emoji, reward, repeat: DAILY \| WEEKLY \| ONCE, kids: { <kidId>: true }, order }` |
| `marks/<chore>_<kid>_<period>` | `{ chore, kid, period, approved, time }` – period is `YYYY-MM-DD`, ISO week `YYYY-Www`, or `once` |
| `txns/<id>` | `{ kid, amount, text, emoji, time }` |

- A kid's balance is the sum of their `txns`; it is never stored, so simultaneous changes can't lose money.
- Writes are multi-path PATCHes. Ids that two phones might write at the same time are fixed, so the second write
  changes nothing: chore payments are `txns/m_<mark key>`, weekly allowance is `txns/a_<kid>_<monday>`.
- Each app applies its writes locally at once and queues them while offline; the server's event stream brings in
  everyone else's changes.

## Testing

`test/mock-rtdb.mjs` stands in for the database and serves the app; `test/e2e.cjs` drives two phones through
sharing a family, approving a chore, going offline and back, and giving a bonus:

```sh
node web/test/mock-rtdb.mjs &
NODE_PATH=$(npm root -g) node web/test/e2e.cjs /tmp/screens
```
