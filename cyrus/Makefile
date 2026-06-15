# Start/stop the local Cyrus daemon + the SQS webhook pump together.
#
#   make up        start the cyrus daemon + the pump (idempotent)
#   make down      stop both
#   make restart   down, then up
#   make status    show what is running
#   make logs      tail both logs
#
# The pump's queue URL is resolved from the CloudFormation stack output by default;
# override any variable on the command line, e.g.
#   make up QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123/q REGION=us-east-1
#
# Auth/secret setup (one-time) lives in ~/.cyrus/.env and Secrets Manager — see the
# project memory / README. This file only manages the two long-running processes.

SHELL      := /bin/bash
CYRUS_HOME ?= $(HOME)/.cyrus
PORT       ?= 3456
CYRUS_URL  ?= http://localhost:$(PORT)
REGION     ?= us-east-1
STACK      ?= CyrusIngressStack
QUEUE_URL  ?=
HERE       := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
PUMP_LOG   ?= /tmp/cyrus-pump.out
CYRUS_LOG  ?= $(CYRUS_HOME)/daemon.out

# Match the pump processes (uv wrapper + python -m proxy) without matching the
# matcher itself: the literal pattern "[-]m proxy" does not match the regex it
# encodes, so the shell running pgrep/pkill is never a false positive.
PUMP_PATTERN := [-]m proxy

.PHONY: help up down restart status logs start-cyrus stop-cyrus start-pump stop-pump
.DEFAULT_GOAL := help

help:
	@echo "make up | down | restart | status | logs"
	@echo "  vars: QUEUE_URL (auto from stack $(STACK)), REGION=$(REGION), PORT=$(PORT), CYRUS_URL=$(CYRUS_URL)"

up: start-cyrus start-pump status

down: stop-pump stop-cyrus

restart: down up

start-cyrus:
	@if curl -s --max-time 2 -o /dev/null http://localhost:$(PORT)/status 2>/dev/null; then \
	  echo "cyrus: already running on :$(PORT)"; \
	else \
	  echo "cyrus: starting…"; \
	  cd "$(CYRUS_HOME)" && JSII_SILENCE_WARNING_DEPRECATED_NODE_VERSION=1 \
	    setsid nohup cyrus > "$(CYRUS_LOG)" 2>&1 < /dev/null & disown; \
	  for i in $$(seq 1 40); do \
	    curl -s --max-time 2 -o /dev/null http://localhost:$(PORT)/status 2>/dev/null && { echo "cyrus: up on :$(PORT)"; break; }; \
	    sleep 1; \
	  done; \
	fi

stop-cyrus:
	@pid=$$(ss -ltnp 2>/dev/null | grep ':$(PORT)' | grep -oP 'pid=\K[0-9]+' | head -1); \
	if [ -n "$$pid" ]; then kill "$$pid" && echo "cyrus: stopped (pid $$pid)"; else echo "cyrus: not running"; fi

start-pump:
	@if pgrep -af "$(PUMP_PATTERN)" | grep -vq "bin/bash"; then \
	  echo "pump: already running"; \
	else \
	  q="$(QUEUE_URL)"; \
	  if [ -z "$$q" ]; then \
	    echo "pump: resolving queue url from stack $(STACK)…"; \
	    q=$$(cd "$(HERE)" && uv run --no-project --with boto3 python -c "import boto3;o=boto3.client('cloudformation',region_name='$(REGION)').describe_stacks(StackName='$(STACK)')['Stacks'][0]['Outputs'];print(next(x['OutputValue'] for x in o if x['OutputKey']=='QueueUrl'))" 2>/dev/null); \
	  fi; \
	  if [ -z "$$q" ]; then echo "pump: ERROR could not resolve QUEUE_URL (pass QUEUE_URL=… or check AWS creds)"; exit 1; fi; \
	  echo "pump: starting (queue=$$q)"; \
	  cd "$(HERE)" && CYRUS_PROXY_FEED=sqs CYRUS_PROXY_BASE_URL=$(CYRUS_URL) CYRUS_PROXY_QUEUE_URL="$$q" \
	    setsid nohup uv run --no-project python -m proxy > "$(PUMP_LOG)" 2>&1 < /dev/null & disown; \
	  sleep 2; \
	  pgrep -af "$(PUMP_PATTERN)" | grep -vq "bin/bash" && echo "pump: up (log $(PUMP_LOG))" || echo "pump: FAILED to start — see $(PUMP_LOG)"; \
	fi

stop-pump:
	@if pgrep -f "$(PUMP_PATTERN)" >/dev/null; then \
	  pkill -f "$(PUMP_PATTERN)"; \
	  for i in $$(seq 1 5); do pgrep -f "$(PUMP_PATTERN)" >/dev/null || break; sleep 1; done; \
	  pkill -9 -f "$(PUMP_PATTERN)" 2>/dev/null || true; \
	  echo "pump: stopped"; \
	else echo "pump: not running"; fi

status:
	@printf "cyrus: "; curl -s --max-time 2 -o /dev/null -w "up (HTTP %{http_code} on :$(PORT))\n" http://localhost:$(PORT)/status 2>/dev/null || echo "down"
	@printf "pump:  "; pids=$$(pgrep -af "$(PUMP_PATTERN)" | grep -v "bin/bash" | awk '{print $$1}' | tr '\n' ' '); [ -n "$$pids" ] && echo "up (pids $$pids)" || echo "down"

logs:
	@echo "== cyrus ($(CYRUS_LOG)) =="; tail -n 20 "$(CYRUS_LOG)" 2>/dev/null; \
	echo; echo "== pump ($(PUMP_LOG)) =="; tail -n 20 "$(PUMP_LOG)" 2>/dev/null
