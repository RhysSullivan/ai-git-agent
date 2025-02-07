import { generateObject, generateText, tool } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';

// Example usage
if (import.meta.main) {
  const filePath = Bun.argv[2];
  const searchDescription = Bun.argv[3];
  const debug = Bun.argv.includes('--debug');

  if (!filePath || !searchDescription) {
    console.error('Usage: bun run index.ts <file_path> <search_description> [--debug]');
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
    if (debug) {
      console.log(`Starting analysis for ${filePath} with description: ${chalk.yellow.bold(searchDescription)}`);
    }
    
    // Use --follow to track file history through renames
    const commits = await git.log(['--follow', absolutePath]);
    
    if (debug) {
      console.log(`Found ${commits.all.length} commits on ${filePath} (including renames)`);
    }

    const relevantResults: Array<{
      commitHash: string;
      diffUrl: string;
      description: string;
      diff: string;
    }> = [];
    
    // Helper function to render the current status
    const renderStatus = (commit: any, currentIndex: number, total: number, matchCount: number) => {
      // Save cursor position
      process.stdout.write('\u001B[s');
      // Move to top of screen
      process.stdout.write('\u001B[0;0H');
      // Clear status area (5 lines)
      process.stdout.write('\u001B[K\u001B[K\u001B[K\u001B[K\u001B[K');
      
      console.log(chalk.blue(`Progress: checking commit ${currentIndex + 1}/${total}`));
      console.log(chalk.dim(`Current commit: ${commit.hash}`));
      console.log(chalk.yellow(`Query: ${searchDescription}`));
      console.log(chalk.green(`Matches found: ${matchCount}`));
      console.log(chalk.dim('─'.repeat(process.stdout.columns)));
      
      // Restore cursor position
      process.stdout.write('\u001B[u');
    };

    // Helper function to render results
    const renderResults = (results: typeof relevantResults, currentIndex: number = 0) => {
      if (results.length === 0) return;
      
      console.clear();
      console.log(chalk.bold(`\n🔍 Found ${results.length} relevant changes:`));
      console.log(chalk.dim(`(Use ← → arrow keys to navigate, press 'q' to quit)\n`));
      
      const result = results[currentIndex];
      console.log(chalk.bold(`Result ${currentIndex + 1}/${results.length}:`));
      console.log(chalk.dim(`Commit: ${result.commitHash}`));
      console.log(chalk.dim(`URL: ${result.diffUrl}`));
      console.log(chalk.dim(`Description: ${result.description}`));
      console.log('\n' + chalk.dim('Changes:'));
      console.log(result.diff);
      console.log('\n' + chalk.dim('─'.repeat(80)) + '\n');
    };

    // Clear screen once at the start
    console.clear();
    // Add initial padding for status area
    console.log('\n'.repeat(5));
    
    for (const commit of commits.all) {
      renderStatus(commit, commits.all.indexOf(commit), commits.all.length, relevantResults.length);

      // Skip first commit as it has no parent to diff against
      if (commit.hash === commits.all[commits.all.length - 1].hash) {
        debug && console.log('Skipping first commit (no parent to diff against)');
        continue;
      }
      
      // Get the relative path from the git root
      const gitRoot = await git.revparse(['--show-toplevel']);
      const relativePath = path.relative(gitRoot.trim(), absolutePath);
      
      debug && console.log(`Getting diff for commit ${commit.hash} with file ${relativePath}`);

      // Get the tree to find the historical path of the file
      const treeFiles = await git.raw([
        'ls-tree',
        '-r',
        commit.hash
      ]);
      
      const filePath = treeFiles.split('\n')
        .find(line => line.includes(relativePath) || line.includes(path.basename(relativePath)));

      if (!filePath) {
        debug && console.warn(`Could not find file in commit ${commit.hash}`);
        continue;
      }

      const historicalPath = filePath.split('\t')[1];
      debug && console.log(`Found file at historical path: ${historicalPath}`);
      
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
        debug && console.warn(`No changes found in commit ${commit.hash} for file ${relativePath}`);
        continue;
      }

      const result = await generateObject({
        model: google('gemini-2.0-flash-001'),
        prompt: `
        You are an expert debugger. The user is giving you a query and a diff of a file and wants to know whether the diff is relevant to the query.

        The query is: ${searchDescription}

        The diff of the file is: ${diff}

        Is the diff relevant to the query?
        `,
        schema: z.object({
          relevant: z.boolean(),
          diffDescription: z.string(),
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
      

      if(result.object.relevant) {
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

        relevantResults.push({
          commitHash: commit.hash,
          diffUrl,
          description: result.object.diffDescription,
          diff: coloredDiff,
        });
        
        // Clear screen below status area and render updated results
        // console.log('\n'.repeat(process.stdout.rows - 5));
        // renderResults(relevantResults);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Final results display
    console.clear();
    console.log(chalk.bold.green(`✨ Search Complete!`));
    console.log(chalk.yellow(`Query: ${searchDescription}`));
    console.log(chalk.blue(`Found ${relevantResults.length} relevant changes\n`));
    
    if (relevantResults.length > 0) {
      let currentIndex = 0;
      renderResults(relevantResults, currentIndex);

      // Set up keyboard controls
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      process.stdin.on('data', (key) => {
        if (key === '\u001B\u005B\u0044') { // Left arrow
          currentIndex = (currentIndex - 1 + relevantResults.length) % relevantResults.length;
          renderResults(relevantResults, currentIndex);
        } else if (key === '\u001B\u005B\u0043') { // Right arrow
          currentIndex = (currentIndex + 1) % relevantResults.length;
          renderResults(relevantResults, currentIndex);
        } else if (key === 'q' || key === '\u0003') { // 'q' or Ctrl+C
          process.exit(0);
        }
      });
    }
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
