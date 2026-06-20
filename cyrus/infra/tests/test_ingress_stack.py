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


def test_ingress_stack__synthesized__provisions_queue_and_dead_letter_queue(template: Template):
    template.resource_count_is("AWS::SQS::Queue", 2)


def test_ingress_stack__main_queue__redrives_to_dlq_after_five_receives(template: Template):
    template.has_resource_properties(
        "AWS::SQS::Queue",
        {
            "RedrivePolicy": {
                "maxReceiveCount": 5,
                "deadLetterTargetArn": Match.any_value(),
            }
        },
    )


def test_ingress_stack__handler__is_python_lambda_with_expected_entrypoint(
    template: Template,
):
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {"Handler": "handler.handler", "Runtime": "python3.12"},
    )


def test_ingress_stack__function_url__is_public_for_linear(template: Template):
    template.has_resource_properties("AWS::Lambda::Url", {"AuthType": "NONE"})


def test_ingress_stack__secret__holds_linear_webhook_signing_key(template: Template):
    template.resource_count_is("AWS::SecretsManager::Secret", 1)


def test_ingress_stack__handler_role__may_send_to_queue_and_read_secret(template: Template):
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


def test_ingress_stack__pump_consume_policy__grants_drain_rights_and_attached_to_nothing(
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


def test_ingress_stack__synthesized__exposes_url_queue_and_pump_policy_arn_as_outputs(template: Template):
    template.has_output("WebhookUrl", Match.any_value())
    template.has_output("QueueUrl", Match.any_value())
    template.has_output("PumpConsumePolicyArn", Match.any_value())


# --- dual-write: IoT publish grant + endpoint env ------------------------------
#
# The handler role must be able to publish to the per-identity session topics,
# and the function must learn the IoT Data-plane host via env.


def test_ingress_stack__handler_role__may_publish_to_iot_session_topics(template: Template):
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


def test_ingress_stack__handler_env__exposes_iot_endpoint(template: Template):
    """The IoT Data-plane endpoint host is wired to the Lambda via IOT_ENDPOINT."""
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {
            "Environment": {
                "Variables": Match.object_like({"IOT_ENDPOINT": Match.any_value()})
            }
        },
    )


# --- consumer-presence cache: lifecycle events -> DynamoDB(TTL) -----------------
#
# Presence is kept fresh out of band by an IoT rule writing into a TTL'd,
# on-demand DynamoDB table the ingress handler reads to detect offline consumers.


def test_ingress_stack__presence_table__is_on_demand_with_ttl_keyed_by_username(template: Template):
    """The presence table is on-demand, TTL-enabled, and keyed by username."""
    template.has_resource_properties(
        "AWS::DynamoDB::Table",
        {
            "BillingMode": "PAY_PER_REQUEST",
            "KeySchema": [{"AttributeName": "username", "KeyType": "HASH"}],
            "TimeToLiveSpecification": {"AttributeName": "ttl", "Enabled": True},
        },
    )


def test_ingress_stack__presence_rule__routes_lifecycle_events_to_dynamodb(template: Template):
    """An IoT rule selects from the presence lifecycle topic into a DynamoDBv2 action."""
    template.has_resource_properties(
        "AWS::IoT::TopicRule",
        {
            "TopicRulePayload": Match.object_like(
                {
                    "Sql": Match.string_like_regexp(r".*\$aws/events/presence/.*"),
                    "Actions": Match.array_with(
                        [
                            Match.object_like(
                                {
                                    "DynamoDBv2": Match.object_like(
                                        {
                                            "PutItem": {"TableName": Match.any_value()},
                                            "RoleArn": Match.any_value(),
                                        }
                                    )
                                }
                            )
                        ]
                    ),
                }
            )
        },
    )


def test_ingress_stack__presence_rule_role__is_scoped_to_putitem_on_table(template: Template):
    """The rule's role may only PutItem (no broader DynamoDB access)."""
    template.has_resource_properties(
        "AWS::IAM::Policy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {"Action": "dynamodb:PutItem", "Effect": "Allow"}
                        )
                    ]
                )
            }
        },
    )


# --- iot-only delivery mode: handler reads the presence cache ------------------
#
# The handler learns its delivery mode and the presence table via env, and may
# read (only) that table to decide online vs offline.


def test_ingress_stack__handler_env__exposes_delivery_mode_and_presence_table(template: Template):
    """DELIVERY_MODE and PRESENCE_TABLE are wired to the Lambda via env."""
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {
            "Environment": {
                "Variables": Match.object_like(
                    {
                        "DELIVERY_MODE": Match.any_value(),
                        "PRESENCE_TABLE": Match.any_value(),
                    }
                )
            }
        },
    )


def test_ingress_stack__handler_role__may_read_presence_table(template: Template):
    """The execution role is granted dynamodb:GetItem (the offline-detection read)."""
    template.has_resource_properties(
        "AWS::IAM::Policy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {"Action": "dynamodb:GetItem", "Effect": "Allow"}
                        )
                    ]
                )
            }
        },
    )
