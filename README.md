# Lift Log

A personal gym app that lives on your phone: log Pull / Push / Legs sessions, see progress charts,
get daily calorie and protein targets for gaining weight, and get a goal weight for every exercise next time.

It is a plain static website (no build step), hosted on GitHub Pages like the quiz. All your data is stored
**on your phone, in the browser** - none of it is in this repo.

```
GitHub Actions (each evening) --> ntfy (holds it until 3:30pm) --> your phone --> tap --> Lift Log (GitHub Pages)
```

## One-time setup

### 1. GitHub
1. Create a **new public repository** called `liftlog`. Don't add a README (this folder already has one).
2. In PowerShell, in this folder:
   ```
   git remote add origin https://github.com/spacekid1910-jpg/liftlog.git
   git push -u origin main
   ```
3. Repo **Settings > Secrets and variables > Actions > New repository secret**:
   name `NTFY_TOPIC`, value the same topic name your ntfy app is subscribed to (the quiz uses the same one).
4. Repo **Settings > Pages**: *Deploy from a branch*, branch **main**, folder **/ (root)**, Save.
   After about a minute the app is live at `https://spacekid1910-jpg.github.io/liftlog/`.

### 2. Test the reminder
Repo > **Actions** > *Gym day reminder* > **Run workflow**:
- **now** (default) buzzes your phone immediately.
- **schedule** queues the next Tuesday/Friday reminder straight away. Check the run log: it prints the day and time it queued.

After that it queues each training day's reminder by itself every evening.
Training days and the time are the `TRAIN_PLAN` and `SEND_TIME` lines near the top of `.github/workflows/remind.yml`.

### 3. Put it on your phone (Android)
1. Open `https://spacekid1910-jpg.github.io/liftlog/` in **Chrome**.
2. Tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
3. Open it from the new icon. Do the install **before** logging workouts, so everything is saved in one place.

## Updating the app
Change the files, then:
```
git add .
git commit -m "Describe the change"
git push
```
GitHub Pages updates in a minute or two. Open the app twice to pick up the new version.

## Backups
Your data lives only in the phone's browser storage. In the app go to **More > Download backup** every few weeks,
and keep the file somewhere safe (it restores with **Import backup file**).
