# ADR-011: Dual LLM Strategy -- Groq for Chat, Anthropic for Planning

## Status

Accepted

## Context and Problem Statement

The system has two distinct LLM workloads with different requirements. Real-time chat needs low-latency tool calling (sub-second first token). Dashboard layout planning needs high-quality multi-step reasoning over complex data manifests. A single LLM provider cannot optimally serve both workloads.

## Decision Drivers

- Sub-second latency required for real-time chat UX
- High-quality multi-step reasoning required for the layout planning pipeline
- Avoidance of single-vendor dependency
- Different SDK requirements for TypeScript (chat) and Python (planner) services

## Considered Options

1. **Dual provider: Groq (chat) + Anthropic Claude (planning)** (selected)
2. **Single provider for both workloads**

### Option 1: Dual LLM Strategy

- Good, because Groq's inference speed is essential for chat UX with sub-second first token
- Good, because Claude excels at structured, multi-step reasoning the LangGraph pipeline requires
- Good, because using two providers avoids single-vendor dependency
- Bad, because two API keys must be managed (`GROQ_API_KEY`, `PLANNER_ANTHROPIC_API_KEY`)
- Bad, because two SDK dependencies are required (`@ai-sdk/groq` in TypeScript, `anthropic` in Python)

### Option 2: Single Provider

- Good, because it simplifies API key management and SDK dependencies
- Good, because it provides a consistent model behavior across workloads
- Bad, because no single provider optimally serves both low-latency chat and high-quality planning
- Bad, because it creates single-vendor dependency

## Decision Outcome

Chosen option: **Dual LLM Strategy**, because Groq's inference speed is essential for real-time chat while Claude's reasoning quality is needed for the multi-step layout planning pipeline, and using two providers avoids single-vendor lock-in.

### Consequences

- **Good:** Each workload uses the optimal model -- Groq (llama-3.3-70b-versatile) for fast chat, Anthropic Claude (claude-sonnet-4-6) for planning. Multi-vendor strategy reduces dependency risk
- **Bad:** Two API keys to manage. Two SDK dependencies across languages. The planner service (`planner/`) is currently standalone and not yet integrated into the main Docker Compose or API surface

## Confirmation

Verify that chat responses maintain sub-second time-to-first-token via Groq. Verify that the layout planner produces high-fidelity output via the LangGraph pipeline with Claude. Confirm both API keys are configured and operational.

## Related

- [ADR-002: Groq over OpenAI for LLM Inference](adr-002-groq-over-openai.md) -- foundational decision for the chat LLM choice
