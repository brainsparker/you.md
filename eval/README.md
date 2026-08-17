# you.md Evaluation Suite

Tests whether you.md personalization signals improve search relevance and AI agent performance.

## Evaluations

### 1. PromptLens Eval (Recommended)

Uses [PromptLens](https://github.com/brainsparker/PromptLens) for LLM-as-judge evaluation, which provides better qualitative scoring than term-matching.

```bash
# Install PromptLens
pip install promptlens

# Run all three profile evaluations
cd eval/promptlens
ANTHROPIC_API_KEY=xxx ./run_eval.sh
```

**Configs:**
- `config_baseline.yaml` - No profile (control)
- `config_expert.yaml` - Expert profile injected as system prompt
- `config_beginner.yaml` - Beginner profile injected as system prompt

**Judge Criteria:**
- `expertise_matching` - Does response match user's expertise level?
- `technical_accuracy` - Is response correct?
- `depth_preference` - Does depth match user's preference?

Results are saved as interactive HTML reports in `results/`.

### 2. Search Relevance (`search_eval.ts`) (Legacy)

Tests whether personalization signals improve search result quality:
- **Query modification**: Adds expertise-level terms to queries
- **Result re-ranking**: Re-orders results based on source preferences
- **Scoring**: Measures against expected good/bad sources and terms

```bash
YOU_API_KEY=xxx npx tsx eval/search_eval.ts
```

### 3. Agent Performance (`agent_eval.ts`) (Legacy)

Tests whether you.md context improves AI responses:
- **Context injection**: Passes user profile to the agent
- **Response scoring**: Checks for expected terms based on expertise level
- **Comparison**: Baseline (no profile) vs personalized

```bash
ANTHROPIC_API_KEY=xxx npx tsx eval/agent_eval.ts
```

## Profiles

- `profiles/expert.md` - Expert developer profile (deep dives, official docs)
- `profiles/beginner.md` - Beginner profile (tutorials, visual content)

## Test Queries

See `queries.json` for test queries with expected results for each profile.

## Results

Results are saved to `results/` directory:
- `eval_results.json` - Search eval results
- `agent_results.json` - Agent eval results

## Metrics

### Search Eval
- **Original Score**: Relevance of unmodified search results
- **Reranked Score**: Relevance after applying profile-based re-ranking
- **Improvement**: Delta between original and reranked

### Agent Eval
- **Score**: % of expected terms present in response
- **Response Length**: Verbosity of response
- **Improvement**: Delta vs no-profile baseline

## Adding New Tests

1. Add queries to `queries.json` with expected results
2. Add profiles to `profiles/` directory
3. Run evals and compare results

## ChatGPT Skill Eval (`chatgpt/`)

Tests the other direction: can the ChatGPT skill turn accumulated context into a
profile worth keeping?

```bash
ANTHROPIC_API_KEY=xxx npm run eval:chatgpt
```

Each fixture in `chatgpt/fixtures.ts` is a synthetic user history plus the
signals a good profile must carry, the incidental details it must leave out, and
facts that would mean the model invented something. `chatgpt/grader.ts` scores
the generated markdown on four checks — valid you.md, full coverage of repeated
signals, no leaked incidentals, no inventions — and a profile passes only if all
four hold. One fixture has nothing worth recording, so "declined to write a
profile" stays a tested outcome.

The eval runs against Claude rather than ChatGPT. What it measures is whether
`apps/chatgpt/skills/you-md/SKILL.md` is unambiguous enough to produce a good
profile, which is the part we control.

The grader itself is covered by `test/chatgpt/skill-eval.test.ts`, so CI verifies
that each failure mode is actually caught without needing an API key.
