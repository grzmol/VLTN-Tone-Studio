# Security policy

## Supported versions

Security fixes go into the latest release. Older versions are not patched; update to the newest one from the [releases page](https://github.com/grzmol/VLTN-Tone-Studio/releases/latest).

## Report a vulnerability

Please report it privately, not in a public issue.

1. Open the [Security tab](https://github.com/grzmol/VLTN-Tone-Studio/security) of the repository.
2. Choose **Report a vulnerability** and describe what you found.

Useful details: the app version and operating system, what an attacker needs (a malicious file, a network position, a crafted pedal message, local access), the steps to reproduce, and what the impact is. Do not include other people's private data.

This is a volunteer project, so replies take as long as they take; expect an acknowledgement and a first assessment, then a fix and a release note when the report is confirmed. You will be credited in the release notes unless you prefer not to be.

## What is in scope

- The desktop app and the browser build: file handling (`.prst`, backups, NAM and IR files, song and chart files), the local band sync server, the update check, token storage and the Electron main process.
- Anything that could make the app write unintended or destructive data to a pedal.

## What is not

- Vulnerabilities in Valeton's pedal firmware or apps: report those to [Valeton](https://www.valeton.net/).
- Vulnerabilities in a third-party package: report them to that package. If this app uses it in a way that makes it exploitable, report that here.
- Problems that need a modified or compromised computer, or physical access to an unlocked one.

## Pedals and safety

The app talks to real hardware. A bug that could brick a pedal or overwrite its presets without a backup is a safety problem even when no attacker is involved; report it the same way.
