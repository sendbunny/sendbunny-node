# Releasing

How a version gets from this repository to npm. Nobody holds an npm token. GitHub Actions stages each release, and a maintainer approves it on npmjs.com with two-step login.

## One-time setup

### npm

Done on 7 November 2026:

1. The npm account `sendbunny` owns the package, with two-step login by passkey.
2. The name was claimed with a placeholder version, 0.0.2. npm held this first version of the new package for approval under **Staged Packages** on npmjs.com before it went live.

Releases never come from anyone's computer: GitHub Actions stages them (below). If a manual publish is ever unavoidable, keep the npm login file out of the package folder, and run `npm pack --dry-run` right before `npm publish` to see every file that would go out.

3. Right before the first real release (the setting expires if no release uses it within 48 hours), open the `sendbunny` package on npmjs.com, then **Settings**:
   - **Trusted publishing**, GitHub Actions: organisation `sendbunny`, repository `sendbunny-node`, workflow `release.yml`, environment `npm`. Allowed actions: **stage publish only**. Do not allow direct publishing.
   - **Publishing access**: "Require two-factor authentication and disallow tokens".

### GitHub

1. Create the organisation `sendbunny` on the free plan: [github.com/account/organizations/new](https://github.com/account/organizations/new). In its settings, require two-step login for everyone.
2. Repository `sendbunny/sendbunny-node`, public, with:
   - a ruleset on `main`: pull request required, checks "Node 20", "Node 22", "Node 24" and CodeQL must pass, no force pushes, no deletion;
   - a ruleset on tags `v*`: only organisation owners may create them, and no updates or deletion once pushed (the release workflow also refuses a tag whose commit is not on `main`);
   - an environment named `npm` that only accepts tags matching `v*`;
   - Actions limited to actions made by GitHub, pinned to full commit SHAs, with read-only default permissions;
   - private vulnerability reporting, secret scanning with push protection, and Dependabot alerts turned on.
3. Never rename, transfer or delete the organisation or the repository while npm trusts them. If you ever must, remove the trusted publisher on npm first. npm ties the trust to these names until a release has validated it.

## Each release

1. In a pull request: set the new version in `package.json` and `src/version.ts`, and describe it in `CHANGELOG.md`. CI must be green. A maintainer merges it.
2. Once the release is approved, tag the merged commit and push that one tag:

   ```bash
   git tag v0.1.0 <commit>
   git push origin v0.1.0
   ```

3. The Release workflow checks that the tag matches `package.json`, runs every check, and **stages** the version on npm. Nothing is public yet.

   If this fails, nothing reaches npm, and the tag stays: release tags can never be moved or deleted. Fix the problem in a pull request and release the next patch version.
4. On npmjs.com, open **Staged Packages**, check the version and its files, and click **Approve** (two-step login).
5. Check the result: `npm view sendbunny version` shows the new version, its npm page shows where it was built, and `npm audit signatures` passes in a project that installs it.
