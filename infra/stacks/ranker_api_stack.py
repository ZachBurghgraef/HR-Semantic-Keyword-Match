from pathlib import Path

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigateway as apigw
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk.aws_ecr_assets import Platform
from constructs import Construct

# Repo root holds the Dockerfile, app.py and src/ that make up the Lambda image.
REPO_ROOT = Path(__file__).resolve().parents[2]


class RankerApiStack(Stack):
    """API Gateway (REST) -> Lambda (container image with JobBERT baked in)."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_group = logs.LogGroup(
            self,
            "RankerFunctionLogs",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # from_image_asset tells CDK to `docker build` REPO_ROOT/Dockerfile during
        # deploy and push the result to the ECR repo created by `cdk bootstrap`.
        # Container images can be up to 10 GB, versus 250 MB unzipped for a
        # zip function plus all its layers, which torch alone exceeds.
        ranker_fn = lambda_.DockerImageFunction(
            self,
            "RankerFunction",
            code=lambda_.DockerImageCode.from_image_asset(
                directory=str(REPO_ROOT),
                platform=Platform.LINUX_AMD64,
            ),
            architecture=lambda_.Architecture.X86_64,
            # Lambda allocates CPU in proportion to memory, so more memory means
            # faster model loading on cold start and faster encoding.
            memory_size=3008,
            timeout=Duration.seconds(60),
            log_group=log_group,
        )

        # LambdaRestApi creates a REST API with a catch-all {proxy+} resource that
        # forwards every path and method to the function; FastAPI does the routing.
        api = apigw.LambdaRestApi(
            self,
            "RankerApi",
            handler=ranker_fn,
            rest_api_name="candidate-ranker-api",
            # Don't create the account-wide API Gateway -> CloudWatch logging role.
            cloud_watch_role=False,
            deploy_options=apigw.StageOptions(
                stage_name="prod",
                throttling_rate_limit=10,
                throttling_burst_limit=20,
            ),
        )

        CfnOutput(self, "ApiUrl", value=api.url)
        CfnOutput(self, "FunctionName", value=ranker_fn.function_name)
