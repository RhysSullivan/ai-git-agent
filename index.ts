import { generateObject, generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import simpleGit from 'simple-git';

const git = simpleGit();
const model = openai('gpt-4o-mini-2024-07-18');

// Example usage
if (import.meta.main) {
  const filePath = Bun.argv[2];
  const searchDescription = Bun.argv[3];

  if (!filePath || !searchDescription) {
    console.error('Usage: bun run index.ts <file_path> <search_description> [commit_range]');
    process.exit(1);
  }
  console.clear()
  console.log(`Starting analysis for ${filePath} with description: ${searchDescription}`);
  // for each commit on the file, get the diff
  const commits = await git.log({ file: filePath });
  // log metadata about the number of commits
  console.log(`Found ${commits.all.length} commits on ${filePath}`);
  for (const commit of commits.all) {
    const diff = await git.diff([commit.hash, '--', filePath]);
    // run the model on the diff to figure out if the commit is relevant to the search description
    const result = await generateObject({
      model,
      prompt: `
      You are an expert debugger. The user is giving you a query and a diff of a file and wants to know whether the diff is relevant to the query.

      The query is: ${searchDescription}

      The diff of the file is: ${diff}

      Is the diff relevant to the query?
      `,
      schema: z.object({
        relevant: z.boolean(),
        reason: z.string(),
      }),
    });
    // remote url is https://github.com/RhysSullivan/ai-git-agent/blob/main/test/route.ts

    // link to the specific commit on github
    const diffUrl = `https://github.com/RhysSullivan/ai-git-agent/commit/${commit.hash}`;
    console.log(result.object, diffUrl);
  }
}
