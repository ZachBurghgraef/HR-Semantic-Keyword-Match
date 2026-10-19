from aws_cdk import CfnOutput, Duration, Stack
from aws_cdk import aws_iam as iam
from constructs import Construct

GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com"
GITHUB_OIDC_HOST = "token.actions.githubusercontent.com"


class GitHubOidcStack(Stack):
    """Lets GitHub Actions log in to AWS with short-lived tokens instead of access keys.

    How it works at deploy time:
      1. The workflow asks GitHub for a signed OIDC token (needs `id-token: write`).
         The token says "I am repo X, running on ref Y".
      2. aws-actions/configure-aws-credentials hands that token to AWS STS
         (AssumeRoleWithWebIdentity) and asks for the role created below.
      3. STS checks the token's signature against the OIDC provider registered
         here, then checks the role's trust policy conditions (repo + branch).
      4. If both pass, STS returns credentials that expire after an hour.

    This stack is deployed once, by hand, from your laptop. It must exist
    before the workflow can log in, so the workflow can't create it itself.
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        github_repo: str,
        branch: str = "main",
        provider_already_exists: bool = False,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # An AWS account can register a given OIDC URL only once. If GitHub's
        # provider was already created (by hand, or for another repo), we look
        # it up by ARN instead of creating a second one, which would fail.
        if provider_already_exists:
            provider = iam.OidcProviderNative.from_oidc_provider_arn(
                self,
                "GitHubOidcProvider",
                f"arn:aws:iam::{self.account}:oidc-provider/{GITHUB_OIDC_HOST}",
            )
        else:
            # OidcProviderNative maps straight to AWS::IAM::OIDCProvider. The
            # older iam.OpenIdConnectProvider does the same job through a
            # custom-resource Lambda, which is an extra moving part we don't need.
            provider = iam.OidcProviderNative(
                self,
                "GitHubOidcProvider",
                url=GITHUB_OIDC_URL,
                # "aud" claim GitHub puts in the token when
                # configure-aws-credentials requests it.
                client_ids=["sts.amazonaws.com"],
            )

        # The trust policy says who may assume the role. OpenIdConnectPrincipal
        # adds the sts:AssumeRoleWithWebIdentity action; the conditions narrow
        # it from "anyone with a GitHub token" to "this repo's main branch".
        # GitHub sets "sub" to repo:<owner>/<repo>:ref:refs/heads/<branch> for
        # push and workflow_dispatch runs. Pull requests and other branches get
        # a different "sub", so they can't assume the role.
        principal = iam.OpenIdConnectPrincipal(
            provider,
            conditions={
                "StringEquals": {
                    f"{GITHUB_OIDC_HOST}:aud": "sts.amazonaws.com",
                    f"{GITHUB_OIDC_HOST}:sub": f"repo:{github_repo}:ref:refs/heads/{branch}",
                },
            },
        )

        role = iam.Role(
            self,
            "GitHubDeployRole",
            assumed_by=principal,
            description=f"Assumed by GitHub Actions in {github_repo} ({branch}) to run cdk deploy",
            max_session_duration=Duration.hours(1),
        )

        # The role itself can do almost nothing. `cdk deploy` doesn't need
        # broad permissions here because it hops into the roles `cdk bootstrap`
        # already created (cdk-<qualifier>-deploy-role-..., -file-publishing-role-,
        # -image-publishing-role-, -lookup-role-) and does the real work as them.
        # CloudFormation then makes the actual changes using the bootstrap
        # cfn-exec role. So all we grant is "may assume the cdk-* roles".
        role.add_to_policy(
            iam.PolicyStatement(
                actions=["sts:AssumeRole"],
                resources=[f"arn:aws:iam::{self.account}:role/cdk-*"],
            )
        )

        # Paste this value into the workflow's role-to-assume (via a repo variable).
        CfnOutput(self, "DeployRoleArn", value=role.role_arn)
