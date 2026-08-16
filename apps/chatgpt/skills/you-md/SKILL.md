---
name: you-md
description: Create, edit, and export the user's portable you.md profile — a user-owned file of stable preferences and context that other AI tools can read. Use when the user asks to create/make/update/show/export their you.md, save what you know about them to a profile, or build a portable profile they can take to another AI.
---

# you.md

A you.md is a small markdown file describing a person: how they like to be
communicated with, what they work on, what they care about, what to avoid. It is
theirs, and it is meant to be read by any AI tool — not just this one.

You write the profile. The you.md server only validates, versions, and stores
what you send it. It never infers anything about the user, so nothing lands in
the profile unless you put it there.

## When to use this

Trigger on requests like:

- "Create my you.md from what you know about me"
- "Make my you.md" / "Save what you know about me to you.md"
- "Create a portable profile from what you know about me"
- "Update my you.md with what you've learned about me"
- "Show me my profile" / "What's in my you.md?"
- "Export my you.md"

The user should never have to learn a command. Any natural phrasing of the above
is the same request.

## Creating a profile

1. **Synthesize first.** Draw only on what you already know about this user from
   available context. Do not ask them to fill in a questionnaire; the point of
   the product is that you already know some of this.
2. **Write the complete markdown yourself** using the template below.
3. **Call `youmd_create_profile`** with that markdown.
4. **Show the user the profile** — the whole thing, in the conversation. Do not
   hide it behind a link or a summary. The conversation is the interface.
5. **Say what you left out and why**, in one line: "I left out things that
   looked temporary or that I wasn't confident about."
6. **Offer the next moves**: remove something, change something, add something,
   or export it.

If `youmd_create_profile` reports that a profile already exists, switch to the
update flow instead of overwriting.

### Template

```markdown
---
schema_version: "1.1"
privacy_level: "private"
source: "chatgpt"
---

# Me

## How I Think

## How I Communicate

## What I Do

## What I'm Working On

## What I'm Into

## Where I'm Headed

## Context

## Don't
```

Omit any section you have no real evidence for. An absent section is fine; an
empty or padded one is worse than nothing. Write plain declarative sentences or
short bullets — this file is read by other models, so clarity beats prose.

## What belongs in a profile

Include information that is:

- **Stable** — "Works as a product manager", "Uses TypeScript", "Prefers concise
  explanations"
- **Repeated** — patterns you have seen more than once, e.g. "Usually asks for
  the simplest explanation first"
- **Currently important** — an active project, a job search, something they are
  learning right now
- **Useful to another AI** — technical background, writing preferences,
  professional context, working style, standing instructions

Exclude information that is:

- **Incidental** — what they ate, a one-off question, a passing mention
- **Ephemeral** — where they are right now, what they are doing today
- **Uncertain** — "might move someday", anything you are inferring from a single
  ambiguous signal
- **Sensitive without payoff** — health, finances, relationships, religion,
  politics, or precise location, unless the user has made clear it should shape
  how AI works with them

### Confidence

Sort every candidate fact into three buckets before writing:

- **High confidence** — stated directly or shown repeatedly. Include it.
- **Medium confidence** — one clear signal, no contradiction. Either leave it out
  or phrase it carefully ("Seems to prefer…"). Prefer leaving it out.
- **Low confidence** — a guess. Leave it out.

Never invent information to make a section look complete. Never extrapolate a
personality from a handful of messages. A short accurate profile is the goal; a
long speculative one is the failure mode.

## Updating a profile

When the user asks for a change — "remove the part about my family", "I'm no
longer interviewing", "add that I prefer Python", "don't include location":

1. Call `youmd_get_profile` to fetch the current markdown and its `version`.
2. Edit **only** what they asked about. Leave every other line byte-for-byte
   intact — you are editing their file, not rewriting it.
3. Call `youmd_update_profile` with the full revised markdown and
   `base_version` set to the version you just fetched.
4. Confirm the specific change in one sentence. Do not reprint the whole profile
   unless they ask for it.

If the update is rejected as stale, the profile changed underneath you: fetch it
again, re-apply the edit, and retry once.

## Exporting

When the user asks to export, download, or take the profile elsewhere, call
`youmd_export_profile` and give them the resulting `you.md` content. Mention that
they can drop it into another AI tool — that portability is the entire point of
the file.

## Showing a profile

For "show me my you.md" or "what does it know about me", call
`youmd_get_profile` and display the markdown as-is.

## Rules

- The profile is the user's data. They can remove anything, for any reason,
  without justifying it.
- Never write to the profile without being asked. There is no silent background
  capture of new facts.
- Never share, compare, or reference another user's profile.
- Keep `privacy_level: "private"` unless the user explicitly asks otherwise.
- If you have almost nothing to work with, say so honestly and offer to build
  the profile as you learn — do not manufacture a profile to fill the space.
