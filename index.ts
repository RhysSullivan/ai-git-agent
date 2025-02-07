import { generateObject, generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';

// Example usage
if (import.meta.main) {
  const filePath = Bun.argv[2];
  const searchDescription = Bun.argv[3];

  if (!filePath || !searchDescription) {
    console.error('Usage: bun run index.ts <file_path> <search_description>');
    process.exit(1);
  }

  try {
    // Resolve the absolute path of the input file
    const absolutePath = path.resolve(filePath);
    
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      console.error('Error: File does not exist:', absolutePath);
      process.exit(1);
    }

    // Get the directory containing the file and initialize git there
    const fileDir = path.dirname(absolutePath);
    const git = simpleGit({ baseDir: fileDir });

    console.clear();
    console.log(`Starting analysis for ${filePath} with description: ${chalk.yellow.bold(searchDescription)}`);
    
    // Use --follow to track file history through renames
    const commits = await git.log(['--follow', absolutePath]);
    console.log(`Found ${commits.all.length} commits on ${filePath} (including renames)`);
    
    for (const commit of commits.all) {
      // Skip first commit as it has no parent to diff against
      if (commit.hash === commits.all[commits.all.length - 1].hash) {
        console.log('Skipping first commit (no parent to diff against)');
        continue;
      }
      
      // Get the relative path from the git root
      const gitRoot = await git.revparse(['--show-toplevel']);
      const relativePath = path.relative(gitRoot.trim(), absolutePath);
      
      console.log(`Getting diff for commit ${commit.hash} with file ${relativePath}`);

      // Get the tree to find the historical path of the file
      const treeFiles = await git.raw([
        'ls-tree',
        '-r',
        commit.hash
      ]);
      
      const filePath = treeFiles.split('\n')
        .find(line => line.includes(relativePath) || line.includes(path.basename(relativePath)));

      if (!filePath) {
        console.warn(`Could not find file in commit ${commit.hash}`);
        continue;
      }

      const historicalPath = filePath.split('\t')[1];
      console.log(`Found file at historical path: ${historicalPath}`);
      
      // Get the diff between this commit and its parent
      const diff = await git.raw([
        'diff',
        `${commit.hash}^`,  // Parent commit
        commit.hash,        // Current commit
        '--',              // Separator
        historicalPath     // The file path at this commit
      ]).catch(err => {
        console.warn(`Failed to get diff for ${commit.hash}: ${err}`);
        return '';
      });

      if (!diff.trim()) {
        console.warn(`No changes found in commit ${commit.hash} for file ${relativePath}`);
        continue;
      }

      const result = await generateObject({
        model: openai('gpt-4o-mini-2024-07-18'),
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

      // Try to get the remote URL for the repository
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find(remote => remote.name === 'origin');
      let diffUrl = `commit: ${commit.hash}`;
      
      if (originRemote?.refs?.fetch) {
        const match = originRemote.refs.fetch.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (match) {
          const repoPath = match[1];
          diffUrl = `https://github.com/${repoPath}/commit/${commit.hash}`;
        }
      }
      

      console.log(result.object, diffUrl);
      if(result.object.relevant) {
        // Replace the simple diff log with colored version
        const coloredDiff = diff.split('\n').map(line => {
          if (line.startsWith('+')) {
            return chalk.green(line);
          } else if (line.startsWith('-')) {
            return chalk.red(line);
          } else if (line.startsWith('@@ ')) {
            return chalk.cyan(line);
          }
          return line;
        }).join('\n');
        
        console.log('diff:', coloredDiff);
        break;
      }
    }
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
