# Releasing

How a version gets from this repository to npm. Nobody holds an npm token. GitHub Actions stages each release, and a maintainer approves it on npmjs.com with two-step login.

## One-time setup

### npm (a maintainer, on their own computer)

1. Sign up at [npmjs.com/signup](https://www.npmjs.com/signup) with a work email address. Pick your own name as the username: npm usernames and organisation names share one list, so a user called `sendbunny` would block the organisation name.
2. Turn on two-step login with a **security key or passkey** (Account, Two-Factor Authentication). Save the recovery codes offline.
3. Create the organisation `sendbunny` on the free plan: [npmjs.com/org/create](https://www.npmjs.com/org/create).
4. Claim the package name. npm only lets the automatic release publish a package that already exists, so the very first version is a placeholder published by hand:

   ```bash
   mkdir sendbunny-placeholder && cd sendbunny-placeholder
   cat > package.json <<'EOF'
   {
     "name": "sendbunny",
     "version": "0.0.1",
     "description": "The official SendBunny SDK. First release soon: https://github.com/sendbunny/sendbunny-node",
     "license": "MIT",
     "repository": { "type": "git", "url": "git+https://github.com/sendbunny/sendbunny-node.git" }
   }
   EOF
   printf '# sendbunny\n\nThe official SendBunny SDK. First release soon: https://github.com/sendbunny/sendbunny-node\n' > README.md
   npm login      # opens the browser; approve with your passkey
   npm publish    # asks for two-step login again
   npm logout     # deletes the token this computer was given
   ```

5. Right before the first real release (the setting expires if no release uses it within 48 hours), open the `sendbunny` package on npmjs.com, then **Settings**:
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
4. On npmjs.com, open **Staged Packages**, check the version and its files, and click **Approve** (two-step login).
5. Check the result: `npm view sendbunny version` shows the new version, its npm page shows where it was built, and `npm audit signatures` passes in a project that installs it.
