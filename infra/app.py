#!/usr/bin/env python3
"""CDK entry point. `cdk synth` / `cdk deploy` run this file (see cdk.json)."""
import os

import aws_cdk as cdk

from stacks.github_oidc_stack import GitHubOidcStack
from stacks.ranker_api_stack import RankerApiStack

app = cdk.App()

# CDK_DEFAULT_ACCOUNT/REGION are filled in by the CDK CLI from whatever
# credentials it's running with (your laptop, or GitHub Actions).
env = cdk.Environment(
    account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
    region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1"),
)

RankerApiStack(app, "RankerApiStack", env=env)

# Deployed once by hand (`cdk deploy GitHubOidcStack`), never by the workflow.
# Pass `-c github_oidc_provider_exists=true` if the account already has
# GitHub's OIDC provider registered.
GitHubOidcStack(
    app,
    "GitHubOidcStack",
    github_repo="ZachBurghgraef/HR-Semantic-Keyword-Match",
    branch="main",
    provider_already_exists=app.node.try_get_context("github_oidc_provider_exists")
    in (True, "true"),
    env=env,
)

app.synth()
