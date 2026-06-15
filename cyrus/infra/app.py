#!/usr/bin/env python3
"""CDK app entry point for the Cyrus webhook ingress stack.

``cdk synth`` / ``cdk deploy`` run this module (see ``cdk.json``). The account and
region come from the ambient CDK environment (the CLI's resolved profile), so the
same code deploys to whichever account you've bootstrapped.
"""

from __future__ import annotations

import os

import aws_cdk as cdk

from stacks.ingress_stack import CyrusIngressStack

app = cdk.App()
CyrusIngressStack(
    app,
    "CyrusIngressStack",
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region=os.environ.get("CDK_DEFAULT_REGION"),
    ),
)
app.synth()
