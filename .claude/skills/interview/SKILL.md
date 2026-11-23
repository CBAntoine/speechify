---
name: interview
description: Interview the user about how they think about and answer their team's questions, then write the generator agent (.claude/agents/generator.md) in their voice and add their real questions and answers to evals/answer_key.md. Use when asked to "interview me", to set up, personalize or rebuild the generator, or to fill in the answer key.
---

# Interview the user, then write the generator

This is the first step of the Generator → Verifier → Coach loop. The generator is a clone of the user that answers their teammates' questions, and the user is the source of truth. Your job is to get how they think and answer into the generator's instructions, and their real questions and answers into the answer key, so the Verifier grades against something true.

## The interview

Ask one question at a time in chat, and wait for each answer. Keep the questions short. When an answer is vague, ask for an example ("How did you reply the last time someone asked that?"). Ask about ten questions, and stop sooner if the user wants to. Skip any question they've already answered, and keep their words.

1. Who asks you questions, and where (Slack, email, calls, comments)?
2. What do they ask most? List your top 10 to 20 questions the way people ask them. Pasting them from Slack works.
3. For each one, what's your answer, exactly as you'd write it? A real reply you've sent is best.
4. How do you answer: how long, and in what form (one line, steps, a link to a doc)?
5. How do you sound? What words or habits do you use, and what do you never say?
6. What do you do when you don't know?
7. What should your clone never do? For example: promise prices or dates, give legal advice, share keys, speak for someone else.
8. When should it ask a question back instead of answering?
9. Where do the answers live? Which files or folders in this repository, and which dashboards or people cover what isn't in it?
10. What do people get wrong that you always have to correct?

## Write the generator

Rewrite `.claude/agents/generator.md`:

- In the frontmatter, keep `name: generator`, `tools: Read, Grep, Glob` and `model`, and rewrite `description` if the job changed. The loop needs that name, and the generator stays read-only.
- In the body, cover who it stands in for and who asks, and where the answers live (the sources from question 9, with paths). Cover how to answer: length, form and tone from questions 4 and 5, in the user's words, with one or two short real replies as examples. Then what to do when it doesn't know, the never-do list, and the corrections from question 10.
- Write plain, specific instructions. Every line should change what the generator does, so leave out filler.
- This file is committed to a public repository. Leave out private details such as people's names, private channels and customer facts, or ask the user first.

Then save it as a version: `node evals/loop.mjs snapshot --note "Rewritten from an interview with the owner."`

## Fill in the answer key

Add each real question from questions 2 and 3 to the Questions table in `evals/answer_key.md`:

- a short ID (letters, numbers and dashes), the question as asked, the user's answer as the ideal answer, and the two or three points that make it right, under Must include;
- `interview` and today's date under Added;
- Held out set to `yes` on about one row in four, spread across topics, so the Coach doesn't see every case.

Read the rows back to the user and fix anything that isn't how they'd say it. Remove the starter rows (Added says `seed`) they don't want. This repository is public, so put anything private in `evals/answer_key.private.md` (same columns; git ignores it) and tell the user which rows went there.

## Then

Run `node evals/loop.mjs check`, and offer a first Level 2 run (`/improve 2`) to see how the new generator does.
