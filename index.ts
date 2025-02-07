import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import simpleGit from 'simple-git';

const git = simpleGit();
const model = openai('gpt-4o');

// Example usage
if (import.meta.main) {
  const filePath = Bun.argv[2];
  const searchDescription = Bun.argv[3];
  const commitRange = Bun.argv[4];

  if (!filePath || !searchDescription) {
    console.error('Usage: bun run index.ts <file_path> <search_description> [commit_range]');
    process.exit(1);
  }
  console.clear()
  console.log(`Starting analysis for ${filePath} with description: ${searchDescription}`);
  // for each commit on the file, get the diff
  const commits = await git.log({ file: filePath });
  for (const commit of commits.all) {
    const diff = await git.diff([commit.hash, '--', filePath]);
    console.log(diff);
  }
}
