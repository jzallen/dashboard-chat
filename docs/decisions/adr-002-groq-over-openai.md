# ADR-002: Groq over OpenAI for LLM Inference

## Status

Accepted

## Context and Problem Statement

The chat agent needs fast LLM inference with tool-calling support for real-time table operations. Users expect immediate feedback when interacting with the chat interface, making time-to-first-token a critical metric.

## Decision Drivers

- Sub-second time-to-first-token for responsive chat UX
- Structured tool-calling support with Zod schema validation
- Compatibility with the Vercel AI SDK provider abstraction
- Model quality sufficient for structured tool calling tasks

## Considered Options

1. **Groq API with llama-3.3-70b-versatile** (selected)
2. **OpenAI API with GPT-4**

### Option 1: Groq

- Good, because Groq's inference hardware delivers sub-second time-to-first-token
- Good, because the model supports structured tool calling with Zod schemas via the Vercel AI SDK
- Good, because the `@ai-sdk/groq` adapter abstracts the provider, making future migration feasible
- Bad, because it creates vendor lock-in to Groq's model catalog
- Bad, because model quality differs from GPT-4/Claude for complex reasoning tasks

### Option 2: OpenAI

- Good, because GPT-4 offers strong reasoning and tool-calling capabilities
- Good, because it has broad ecosystem support and documentation
- Bad, because inference latency is higher, degrading the real-time chat experience
- Bad, because cost per token is significantly higher for comparable throughput

## Decision Outcome

Chosen option: **Groq API with llama-3.3-70b-versatile**, because its inference hardware delivers the sub-second latency critical for a responsive chat UX, and the Vercel AI SDK abstraction layer makes future provider migration feasible.

### Consequences

- **Good:** Chat responses begin streaming within sub-second latency, meeting UX expectations for real-time interaction
- **Bad:** Vendor lock-in to Groq's model catalog; model quality may need upgrading for more complex reasoning tasks beyond structured tool calling

## Confirmation

Measure time-to-first-token in chat responses and verify it remains under one second. Confirm tool-calling reliability with Zod schema validation in production workloads.

## Related

- [ADR-011: Dual LLM Strategy](adr-011-dual-llm-strategy.md) -- extends this decision with a second LLM for planning workloads
