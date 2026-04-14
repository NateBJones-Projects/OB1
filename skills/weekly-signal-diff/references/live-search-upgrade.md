# Live Search Upgrade

Use this file only when the environment supports current web retrieval and the
user wants fresh, source-backed coverage.

## Preferred Upgrade Path

For OB1 users with OpenRouter access, prefer the Perplexity Sonar family for
the retrieval pass. Start with the strongest Sonar search tier available in the
user's account. Use the plain Sonar tier as the lowest-cost fallback when
budget matters more than depth.

Useful references:

- [OpenRouter: Perplexity Sonar](https://openrouter.ai/perplexity/sonar/api)
- [Perplexity Sonar docs](https://docs.perplexity.ai/docs/sonar/models/sonar)
- [Perplexity search filters](https://docs.perplexity.ai/docs/grounded-llm/chat-completions/filters/academic-filter)

## Retrieval Pattern

Run the search in two passes:

1. Broad sweep
   - scan the last 7 days across the suggested categories and high-priority
     entities
   - return only source-backed developments with links or citations
   - shortlist the stories that look like structural change

2. Targeted follow-up
   - deepen only the top 3-7 candidate shifts
   - tighten recency, domain filters, or entity filters when needed
   - pull enough evidence to explain both the general impact and the personal
     relevance

## What to Ask the Search Layer For

Prefer prompts or search instructions that request:

- a 7-day freshness window unless the user says otherwise
- cited links or explicit source URLs
- domain filters when the user trusts a specific set of outlets
- one-paragraph explanations of why each result matters
- rejection of results that are just launch noise or funding theater

## Automation Notes

For scheduled runs:

- keep the retrieval and synthesis structure consistent every week
- store the final digest back in Open Brain so next week's run has something to
  diff against
- track the week-ending date in the saved summary
- if cost matters, use a cheaper broad sweep and spend extra search depth only
  on the top candidate shifts

The search layer finds the evidence. Open Brain decides what matters to this
user. Keep those roles separate.
