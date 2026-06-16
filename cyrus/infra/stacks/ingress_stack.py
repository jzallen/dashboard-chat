"""CDK stack for the Cyrus webhook ingress.

Provisions the public edge of the pull-based pipe: a Lambda Function URL that
HMAC-verifies Linear webhooks (``CyrusIngressHandler``) and enqueues the valid
ones to an SQS queue with a dead-letter queue. The local pump drains that queue
over the instance profile's credentials — so the stack also emits a standalone
``CyrusPumpConsumePolicy`` (attached to nothing) whose ARN is output for an
operator to attach manually to the DevPod instance role. The stack knows nothing
about DevPod; it only grants consume rights on the queue to whoever holds the
policy.
"""

from __future__ import annotations

import os

from constructs import Construct

from aws_cdk import CfnOutput, Duration, Stack, SymlinkFollowMode
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_secretsmanager as secretsmanager
from aws_cdk import aws_sqs as sqs

# SQS consume rights the local pump needs to drain and acknowledge messages.
_PUMP_CONSUME_ACTIONS = [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:GetQueueAttributes",
    "sqs:GetQueueUrl",
    "sqs:ChangeMessageVisibility",
]


class CyrusIngressStack(Stack):
    """Lambda Function URL + SQS ingress for Linear webhooks."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        dead_letter_queue = sqs.Queue(
            self,
            "LinearWebhookDLQ",
            retention_period=Duration.days(14),
        )
        queue = sqs.Queue(
            self,
            "LinearWebhookQueue",
            visibility_timeout=Duration.seconds(60),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=5,
                queue=dead_letter_queue,
            ),
        )

        secret = secretsmanager.Secret(
            self,
            "LinearWebhookSecret",
            description="Linear webhook signing secret (the Linear-Signature HMAC key)",
        )

        # The AWS IoT Data-plane endpoint host the handler publishes to. Sourced
        # from CDK context (``cdk deploy -c iot_endpoint=...``) or the IOT_ENDPOINT
        # environment variable, never a hardcoded region/account.
        iot_endpoint = (
            self.node.try_get_context("iot_endpoint")
            or os.environ.get("IOT_ENDPOINT", "")
        )

        handler_fn = lambda_.Function(
            self,
            "CyrusIngressHandler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="handler.handler",
            # follow_symlinks bundles the real linear_signature.py (symlinked into
            # the asset) so the Lambda carries the same signing module the pump uses.
            code=lambda_.Code.from_asset(
                "ingress",
                follow_symlinks=SymlinkFollowMode.ALWAYS,
                exclude=["__pycache__", "*.pyc"],
            ),
            timeout=Duration.seconds(10),
            environment={
                "QUEUE_URL": queue.queue_url,
                "SECRET_ARN": secret.secret_arn,
                "IOT_ENDPOINT": iot_endpoint,
            },
        )
        queue.grant_send_messages(handler_fn)
        secret.grant_read(handler_fn)

        # Least-privilege publish-only grant scoped to the per-identity session
        # topics (cyrus/v1/sessions/*). Partition stays literal so the ARN renders
        # as a plain string; region/account are wildcards rather than hardcoded, so
        # the grant is region-agnostic without widening to topic/*.
        session_topic_arn = self.format_arn(
            service="iot",
            partition="aws",
            region="*",
            account="*",
            resource="topic",
            resource_name="cyrus/v1/sessions/*",
        )
        iot_publish_policy = iam.Policy(
            self,
            "CyrusIngressIotPublishPolicy",
            roles=[handler_fn.role],
            statements=[
                iam.PolicyStatement(
                    actions=["iot:Publish"],
                    resources=[session_topic_arn],
                )
            ],
        )
        # CDK collapses a single-action statement to a scalar; keep Action as a
        # JSON array so the grant reads as an explicit, extensible action list.
        iot_publish_policy.node.default_child.add_property_override(
            "PolicyDocument.Statement.0.Action", ["iot:Publish"]
        )

        function_url = handler_fn.add_function_url(
            auth_type=lambda_.FunctionUrlAuthType.NONE,
        )

        pump_consume_policy = iam.ManagedPolicy(
            self,
            "CyrusPumpConsumePolicy",
            description=(
                "Attach to the DevPod EC2 instance role so the local pump can "
                "drain and acknowledge the Linear webhook queue."
            ),
            statements=[
                iam.PolicyStatement(
                    actions=_PUMP_CONSUME_ACTIONS,
                    resources=[queue.queue_arn],
                )
            ],
        )

        CfnOutput(self, "WebhookUrl", value=function_url.url)
        CfnOutput(self, "QueueUrl", value=queue.queue_url)
        CfnOutput(
            self,
            "PumpConsumePolicyArn",
            value=pump_consume_policy.managed_policy_arn,
        )
