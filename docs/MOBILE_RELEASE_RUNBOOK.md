# Mobile release runbook

How to cut a `packages/mobile` release without stranding the fleet.

The app is distributed as a sideloaded APK from `/mobile-setup`, not a store, so
nothing about this is automatic — and two of the steps are ordering-sensitive in
ways that cause real outages if done backwards.

## The forced-update gate

`src/app/_layout.tsx` compares `Constants.expoConfig.version` (from `app.json`)
against the `mobile_app_version` setting on the server. **Any** mismatch blocks
the app entirely, before login.

That means the server setting is a kill switch for every installed client. Set
it to a version whose APK is not yet downloadable and the whole fleet is locked
out until it is.

## Order of operations

1. **Bump the version in all three places.** `app.json` is the source of truth;
   `package.json` and `android/app/build.gradle` must agree with it. Also
   increment `versionCode` in the gradle file — Android refuses an in-place
   upgrade unless it strictly increases, and for a sideloaded fleet that means
   uninstalling by hand on every phone.

   | File | Field |
   |---|---|
   | `packages/mobile/app.json` | `expo.version` |
   | `packages/mobile/package.json` | `version` |
   | `packages/mobile/android/app/build.gradle` | `versionName`, `versionCode` |

2. **Commit and push.** APKs are built on the maintainer's laptop from a GitHub
   checkout, not on the dev server, which has no Android toolchain.

3. **Build the APK** and confirm it installs over the previous version on a real
   device.

4. **Publish it to `/mobile-setup`** so the download actually exists.

5. **Only then** update the `mobile_app_version` setting (and
   `mobile_app_release_notes`) via Settings. This is the step that pushes every
   client to the update screen, so it goes last.

## Before an update that changes signing

Switching off the debug signing key is a one-way door for the installed fleet:
the new APK cannot install over the old one, so every phone needs an uninstall
and reinstall.

Uninstalling **discards anything still in the offline outbox** — queued punches
and counts that have not reached the server yet. Before a signing cutover:

- Tell staff to open the app on the shop LAN and confirm the sync banner is
  clear (or that Pending Sync shows nothing).
- Only then have them uninstall and reinstall.

See the comments in `android/app/build.gradle` for how to supply the release
keystore. It is deliberately opt-in: builds keep using the debug key until the
`FORSON_UPLOAD_*` properties are provided, so this cannot happen by accident.

## Why `cli.appVersionSource` is pinned to `local`

`eas.json` sets `cli.appVersionSource: "local"` deliberately. EAS is moving its
default to `remote`, which would let EAS manage version numbers itself. That
would break the update gate: it compares `Constants.expoConfig.version` — which
comes from `app.json` — against the server setting, so a remotely-managed
version would be one the gate never sees, and clients would be told to update
forever or never.

Note that `eas.json` is strictly schema-validated and rejects unknown keys, so
it cannot carry `//` comment fields. Explanations for its contents belong here.

## Things that are silently ignored

- `android/` is committed in this repo, so gradle edits do take effect. Do not
  assume otherwise — this differs from a stock Expo setup where the folder is
  gitignored and regenerated.
- `usesCleartextTraffic` must stay enabled: the backend is reached over plain
  HTTP on a LAN IP.
- ABI splits and AAB were rejected deliberately. Distribution is a single URL,
  and per-architecture APKs would need the download endpoint to detect the
  device's architecture.
