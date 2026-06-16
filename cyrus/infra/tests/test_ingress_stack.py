"""Specification for the Cyrus ingress CDK stack (synthesized CloudFormation).

Each test pins one property of the synthesized template via fine-grained
assertions rather than a brittle full-template snapshot: the queue/DLQ redrive,
the Function URL's open auth (signature IS the auth), the Lambda's runtime/handler,
the function role's send + secret-read grants, and the standalone pump policy that
is attached to no principal (an operator attaches it to the DevPod role by hand).

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. ``Match.absent()`` on the
pump policy's Roles/Users/Groups is load-bearing — it proves the stack stays
decoupled from DevPod. Don't relax it by attaching the policy in the stack.
"""

from __future__ import annotations

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Match, Template

from stacks.ingress_stack import CyrusIngressStack

CONSUME_ACTIONS = [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:GetQueueAttributes",
    "sqs:GetQueueUrl",
    "sqs:ChangeMessageVisibility",
]


@pytest.fixture(scope="module")
def template() -> Template:
    app = cdk.App()
    stack = CyrusIngressStack(app, "TestCyrusIngressStack")
    return Template.from_stack(stack)


def test_provisions_a_queue_and_a_dead_letter_queue(template: Template):
    template.resource_count_is("AWS::SQS::Queue", 2)


def test_main_queue_redrives_to_the_dlq_after_five_receives(template: Template):
    template.has_resource_properties(
        "AWS::SQS::Queue",
        {
            "RedrivePolicy": {
                "maxReceiveCount": 5,
                "deadLetterTargetArn": Match.any_value(),
            }
        },
    )


def test_ingress_handler_is_a_python_lambda_with_the_expected_entrypoint(
    template: Template,
):
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {"Handler": "handler.handler", "Runtime": "python3.12"},
    )


def test_function_url_is_public_so_linear_can_call_it(template: Template):
    template.has_resource_properties("AWS::Lambda::Url", {"AuthType": "NONE"})


def test_secret_holds_the_linear_webhook_signing_key(template: Template):
    template.resource_count_is("AWS::SecretsManager::Secret", 1)


def test_handler_role_may_send_to_the_queue_and_read_the_secret(template: Template):
    template.has_resource_properties(
        "AWS::IAM::Policy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {"Action": Match.array_with(["sqs:SendMessage"])}
                        ),
                        Match.object_like(
                            {
                                "Action": Match.array_with(
                                    ["secretsmanager:GetSecretValue"]
                                )
                            }
                        ),
                    ]
                )
            }
        },
    )


def test_pump_consume_policy_grants_drain_rights_and_is_attached_to_nothing(
    template: Template,
):
    template.has_resource_properties(
        "AWS::IAM::ManagedPolicy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [Match.object_like({"Action": CONSUME_ACTIONS})]
                )
            },
            "Roles": Match.absent(),
            "Users": Match.absent(),
            "Groups": Match.absent(),
        },
    )


def test_exposes_url_queue_and_pump_policy_arn_as_outputs(template: Template):
    template.has_output("WebhookUrl", Match.any_value())
    template.has_output("QueueUrl", Match.any_value())
    template.has_output("PumpConsumePolicyArn", Match.any_value())


# --- dual-write: IoT publish grant + endpoint env ------------------------------
#
# The handler role must be able to publish to the per-identity session topics,
# and the function must learn the IoT Data-plane host via env.


def test_handler_role_may_publish_to_iot_session_topics(template: Template):
    """The execution role is granted iot:Publish scoped to cyrus/v1/sessions/*."""
    template.has_resource_properties(
        "AWS::IAM::Policy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {
                                "Action": Match.array_with(["iot:Publish"]),
                                "Resource": Match.string_like_regexp(
                                    r".*topic/cyrus/v1/sessions/\*"
                                ),
                            }
                        )
                    ]
                )
            }
        },
    )


def test_handler_env_exposes_the_iot_endpoint(template: Template):
    """The IoT Data-plane endpoint host is wired to the Lambda via IOT_ENDPOINT."""
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {
            "Environment": {
                "Variables": Match.object_like({"IOT_ENDPOINT": Match.any_value()})
            }
        },
    )
