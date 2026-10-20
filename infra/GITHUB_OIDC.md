# GitHub Actions → AWS without access keys (OIDC)

`stacks/github_oidc_stack.py` (`GitHubOidcStack`) lets the deploy workflow log in
to AWS with a short-lived token instead of the stored `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` secrets. It creates:

- **An IAM OIDC provider** for `token.actions.githubusercontent.com`. This tells
  AWS to trust tokens signed by GitHub. There can be only one per account.
- **An IAM role** (`GitHubDeployRole`) whose trust policy accepts only tokens
  for `repo:ZachBurghgraef@32226162/HR-Semantic-Keyword-Match@1412423117:ref:refs/heads/main`.
  This repo uses GitHub's *immutable subject* format, which adds the numeric
  owner and repo IDs. Check a repo's format with
  `curl https://api.github.com/repos/<owner>/<repo>/actions/oidc/customization/sub`.
  Its only permission is `sts:AssumeRole` on `cdk-*` roles, the roles that
  `cdk bootstrap` created. `cdk deploy` does all real work through those.

The workflow deploys only `RankerApiStack`. `GitHubOidcStack` is deployed by
hand, because the workflow needs the role before it can log in.

## One-time setup

Run these from `infra/` on your laptop, with the admin credentials you already
use for AWS (the same ones that ran `cdk bootstrap`).

1. Check whether the account already has GitHub's OIDC provider:

   ```bash
   aws iam list-open-id-connect-providers
   ```

   If the output lists an ARN ending in `token.actions.githubusercontent.com`,
   add `-c github_oidc_provider_exists=true` to the two `cdk` commands below.

2. Preview, then deploy, the stack:

   ```bash
   cdk diff GitHubOidcStack
   ```

   ```bash
   cdk deploy GitHubOidcStack
   ```

   CDK asks you to approve the IAM changes; answer `y`. When it finishes it
   prints `GitHubOidcStack.DeployRoleArn = arn:aws:iam::<account>:role/GitHubOidcStack-GitHubDeployRole...`.

3. In GitHub, go to **Settings → Secrets and variables → Actions → Variables**
   and add a repository **variable** (not a secret):
   `AWS_DEPLOY_ROLE_ARN` = the ARN from step 2.
   A role ARN isn't sensitive. Without a matching token, nobody can assume it.

4. Run the workflow (push to `main`, or **Actions → Deploy with AWS CDK → Run
   workflow** on `main`). The *Configure AWS Credentials* step should log
   `Authenticated as assumedRoleId ...GitHubDeployRole...`.

5. Once a deploy has succeeded, delete these repository secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_SAM_BUCKET` (left over from SAM; the CDK workflow doesn't use it)

   Then delete or deactivate that access key in IAM (**IAM → Users → <user> →
   Security credentials**). Deleting the secret alone leaves a working key.

## Things that will be refused (by design)

- Workflow runs on other branches, tags or pull requests. Their token `sub` is
  different, so STS rejects them. To allow more, edit `branch` / the `sub`
  condition in `github_oidc_stack.py` and redeploy the stack by hand.
- Adding `environment:` to the deploy job. That changes `sub` to
  `repo:<owner>/<repo>:environment:<name>`, so the trust policy must change too.
- Renaming or transferring the repo. Update `github_repo` in `app.py` and
  redeploy `GitHubOidcStack`.
