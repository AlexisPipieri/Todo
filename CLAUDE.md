# tdy

A minimal macOS menu bar todo app built with Electron.

## Development

```bash
npm run dev          # build CSS + launch app in dev mode (window visible on start)
npm run dev:seed     # same but uses isolated test data directory
```

## Install to /Applications

```bash
npm run install-app  # build CSS, package with electron-builder, replace /Applications/tdy.app
```

After installing, relaunch the app from /Applications or Spotlight.

> Note: `install-app` kills any running instance and does a clean replace — no nesting issues.

## Release

Only release when asked. From any computer (no Apple certificate needed locally):

```bash
git switch main && git pull      # main clean, CI green
npm version patch && git push --follow-tags
```

The `v*` tag triggers `.github/workflows/release.yml` (~5 min): tests, signs, notarizes, verifies the notarization, then publishes a GitHub Release with `tdy-arm64.dmg`, `tdy-<version>-arm64-mac.zip`, the blockmaps and `latest-mac.yml`. The landing page download button (`releases/latest/download/tdy-arm64.dmg`) and in-app updates both read that release, so it must not be a draft or prerelease.

**Dry run** (published as a prerelease, ignored by the landing page and updates): on a throwaway branch run `npm version 1.0.X-test.1`, push the branch and the tag, then clean up with `gh release delete vX --cleanup-tag --yes` and delete the branch.

**Repository secrets** (GitHub → AlexisPipieri/tdy → Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `CSC_LINK` | Developer ID Application cert exported as `.p12` (Keychain Access → My Certificates → Export), then `base64 -i cert.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | the password chosen at export |
| `APPLE_API_KEY_P8` | contents of the `AuthKey_XXXX.p8` (App Store Connect → Users and Access → Integrations → Team Keys; downloadable once) |
| `APPLE_API_KEY_ID` | that key's Key ID |
| `APPLE_API_ISSUER` | the Issuer ID shown on the same page |

**The certificate expires on 2027-02-01.** After that, releases fail at signing (already published, notarized versions keep working). Renew: create a new "Developer ID Application" certificate on developer.apple.com, export it as `.p12`, replace `CSC_LINK` and `CSC_KEY_PASSWORD`, run a dry run. Keep a copy of the `.p12` in 1Password and delete it from disk.

**Auto-update**: electron-updater on macOS needs the `.zip` next to the dmg (a dmg-only release fails with "ZIP file not provided"). The app checks at launch, when the window opens and on wake, at most once a day (`src/update-policy.js`); when a download finishes it shows a "Restart" banner and a tray menu item.

**Gotchas**
- The repo is `AlexisPipieri/tdy` (renamed from `Todo`). Installed apps still query the old name through GitHub's redirect: never create a new repo called `Todo`.
- electron-builder skips notarization silently when credentials are missing (that is why the workflow checks the secrets and verifies the result). It also publishes drafts by default (`releaseType: release` is set).
- The workflow imports the certificate into its own keychain: electron-builder 26.7.0's own keychain handling fails on macOS 26 runners.
- If `gh` answers 401, an invalid `GH_TOKEN` env var is overriding the login: use `env -u GH_TOKEN gh ...`.
- Minimum macOS is 12 (Electron 40); Electron 44+ requires macOS 13, so update the landing page note if Electron is upgraded.
- Local fallback on the Mac that holds the certificate: `APPLE_KEYCHAIN_PROFILE=tdy npm run dist` (notarytool profile `tdy` in the keychain), then upload with `gh release create`.

## Features

- **Tasks**: add via input bar, click text to edit inline, check to complete, × to delete
- **Deadlines**: set via `@` inline syntax (e.g. `@tomorrow`, `@monday`, `@may 5`) or calendar icon on hover; shown as a pill on the task
- **Projects**: assign color-coded tags via `#` inline syntax or tag icon on hover; create new projects inline
- **Buckets**: tasks live in Today or Anytime; move between them via tray icons on hover
- **Completed section**: tasks completed today shown below active tasks as "N done today" toggle
- **Views**: Today (focus view) and All (shows Today + Anytime sections with project filter chips)
- **Tray icon**: left-click to show/hide window; right-click for menu with data file path, Show in Finder, Restart, Quit
- **Onboarding**: on first launch (no `tasks.json` yet) the window opens under the tray icon with a welcome card pointing at it; dismissal is stored in `prefs.json`. Force it with `TDY_ONBOARDING=1 npm run dev:seed`
- **Auto-rollover**: uncompleted tasks carry over daily; midnight check reloads tasks automatically

## Data

Tasks are stored in `~/Library/Application Support/tdy/tasks.json` (or `tdy-test/` when using `dev:seed`).
