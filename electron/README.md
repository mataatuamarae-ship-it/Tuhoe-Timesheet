# Tuhoe Timesheet — portable Windows app

A real desktop app (built with Electron, same style of build as Harvest
Decs): double-click the .exe, no install needed, no internet needed. Its
data is saved as a plain JSON file (`timesheet-data.json`) **right next to
the .exe**, so if you put the whole folder on a USB / portable hard drive,
the app and your data travel together — plug it into any Windows PC, run
it, and your entries are there. No browser storage involved this time.

## Getting the built app (Setup.exe / Portable.exe)

I can't compile a Windows .exe from here directly, so this ships as a
buildable project plus a GitHub Actions workflow that does the compiling on
a real Windows machine in the cloud (this is the same pattern Harvest Decs
almost certainly uses).

1. Push this whole folder to a GitHub repo (a new one, or a folder in an
   existing one — e.g. alongside Harvest Decs).
2. GitHub Actions will run automatically on the push (see
   `.github/workflows/build.yml`), or trigger it manually from the repo's
   **Actions** tab → **Build Tuhoe Timesheet (Windows)** → **Run workflow**.
3. Once it finishes (a couple of minutes), open that workflow run and
   download the **Tuhoe-Timesheet-Windows** artifact — a zip containing:
   - `Tuhoe Timesheet-Portable.exe` — the one you want for a USB/portable
     drive. No install, just run it from wherever it sits.
   - `Tuhoe Timesheet-Setup.exe` — a normal installer, if you'd rather put
     it on a specific PC's Start Menu instead.
   - a plain `.zip` of the built app folder, if you'd rather unzip it
     yourself.
4. Copy `Tuhoe Timesheet-Portable.exe` onto the drive. The first time you
   run it there, it creates `timesheet-data.json` next to itself and seeds
   your migrated history into it. From then on, every entry saves straight
   to that file.

## Moving it between computers

Because the data file lives beside the .exe, not in Windows' per-PC user
folder, this is the one version where you *don't* need Backup/Restore just
to switch machines — just carry the folder (or the whole drive). The
in-app **Backup data** / **Restore data** buttons are still there as an
extra safety copy (e.g. if the drive itself ever gets lost or corrupted).

## Running/testing it locally without building an .exe

If you (or I, in a future session) have Node.js installed:

```
npm install
npm start
```

That runs the app directly via Electron, no packaging needed — handy for
quick testing before doing a real build.

## Updating the app later

Change `app/index.html` (or `main.js`/`preload.js`) and push again — the
workflow rebuilds automatically. `timesheet-data.json` isn't part of the
built app, so nobody's saved entries are touched by an update.
