import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgenticCodingTaskContract,
} from './agentic-coding-contract.js';
import {
  AgenticCodingEditProposalProducerDispatch,
  AgenticCodingRunOptions,
  AgenticCodingRunStatus,
  AgenticCodingVerificationResult,
  applyDeclaredEdits,
  previewDeclaredEdits,
  runVerificationCommands,
} from './agentic-coding-runner.js';
import { generateEditProposal } from './edit-proposal-producer.js';
import type { CodeBuddyClient, CodeBuddyMessage } from '../../codebuddy/client.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint-manager.js';

const execFileAsync = promisify(execFile);

async function rollbackFiles(repo: string, relativePaths: string[]): Promise<void> {
  for (const relPath of relativePaths) {
    try {
      await execFileAsync('git', ['checkout', '--', relPath], { cwd: repo, windowsHide: true });
      await execFileAsync('git', ['clean', '-f', '--', relPath], { cwd: repo, windowsHide: true });
    } catch (err) {
      // Ignore rollback failures for untracked/uncommitted files or non-git environments
    }
  }
}

export async function runVerificationAndSelfCorrectionLoop(
  contract: AgenticCodingTaskContract,
  options: AgenticCodingRunOptions,
  dispatch: AgenticCodingEditProposalProducerDispatch,
  customClient?: CodeBuddyClient,
  maxIterations = 4
): Promise<{
  status: AgenticCodingRunStatus;
  verification: AgenticCodingVerificationResult[];
  iterations: number;
  contract: AgenticCodingTaskContract;
}> {
  let currentContract = { ...contract };
  let checkpointToResume = null;
  if (options.resume) {
    checkpointToResume = await loadCheckpoint(options.resume);
  }

  let currentVerification: AgenticCodingVerificationResult[] = [];
  let hasFailed = false;

  if (checkpointToResume && checkpointToResume.step === 'applied') {
    currentContract = checkpointToResume.contract;
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );
    hasFailed = currentVerification.some((result) => result.status !== 'passed');
  } else if (checkpointToResume && checkpointToResume.step === 'proposal_generated') {
    currentContract = checkpointToResume.contract;
    await applyDeclaredEdits(currentContract);
    if (options.runId) {
      await saveCheckpoint({
        runId: options.runId,
        options,
        contract: currentContract,
        step: 'applied',
        timestamp: new Date().toISOString(),
      });
    }
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );
    hasFailed = currentVerification.some((result) => result.status !== 'passed');
  } else {
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );
    hasFailed = currentVerification.some((result) => result.status !== 'passed');
  }

  // If any verification command was blocked by safety checks, exit immediately.
  const hasBlocked = currentVerification.some((result) => result.status === 'blocked');
  if (hasBlocked) {
    return {
      status: 'verification_failed',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
    };
  }

  // If applyEdits is false, do not attempt to produce edits or self-correct.
  if (options.applyEdits === false) {
    return {
      status: hasFailed ? 'verification_failed' : 'verified',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
    };
  }

  if (!hasFailed) {
    if (options.runId) {
      await saveCheckpoint({
        runId: options.runId,
        options,
        contract: currentContract,
        step: 'verified',
        timestamp: new Date().toISOString(),
        verification: currentVerification,
      });
    }
    return {
      status: 'verified',
      verification: currentVerification,
      iterations: 0,
      contract: currentContract,
    };
  }

  if (currentContract.edits.length === 0) {
    try {
      const initialProposal = await generateEditProposal(dispatch, customClient);
      currentContract.edits = initialProposal.edits;

      if (options.runId) {
        await saveCheckpoint({
          runId: options.runId,
          options,
          contract: currentContract,
          step: 'proposal_generated',
          timestamp: new Date().toISOString(),
        });
      }

      await applyDeclaredEdits(currentContract);

      if (options.runId) {
        await saveCheckpoint({
          runId: options.runId,
          options,
          contract: currentContract,
          step: 'applied',
          timestamp: new Date().toISOString(),
        });
      }

      // Re-run verification after applying the newly generated edits
      currentVerification = await runVerificationCommands(
        currentContract,
        options.verificationTimeoutMs ?? 120000
      );

      hasFailed = currentVerification.some((result) => result.status !== 'passed');
      if (!hasFailed) {
        if (options.runId) {
          await saveCheckpoint({
            runId: options.runId,
            options,
            contract: currentContract,
            step: 'verified',
            timestamp: new Date().toISOString(),
            verification: currentVerification,
          });
        }
        return {
          status: 'verified',
          verification: currentVerification,
          iterations: 0,
          contract: currentContract,
        };
      }
    } catch (err) {
      return {
        status: 'verification_failed',
        verification: currentVerification,
        iterations: 0,
        contract: currentContract,
      };
    }
  }

  // Keep a copy of the messages history for self-correction turns
  const messagesHistory: CodeBuddyMessage[] = [...dispatch.messages] as CodeBuddyMessage[];

  for (let iter = 0; iter < maxIterations; iter++) {
    // 1. Get current git diff before rolling back
    let diff = '';
    try {
      const diffResult = await execFileAsync('git', ['diff'], {
        cwd: currentContract.repo,
        windowsHide: true,
      });
      diff = diffResult.stdout;
    } catch {
      // Fallback if git diff fails
    }

    // 2. Format the failures and diff for the LLM
    const failedDetails = currentVerification
      .filter((v) => v.status !== 'passed')
      .map((v) => {
        return `Command: ${v.command}\nExit Code: ${v.exitCode}\nStdout:\n${v.stdout}\nStderr:\n${v.stderr}\nReason: ${v.reason ?? ''}`;
      })
      .join('\n\n');

    const promptContent = `Verification failed. Here are the details of the failures:

${failedDetails}

Here is the git diff of the changes made:
\`\`\`diff
${diff}
\`\`\`

Please analyze the failure and generate a new, corrected edit proposal to resolve the errors. Make sure the proposed changes fix the failing tests/checks and do not introduce new issues.`;

    // 3. Construct message turns: previous assistant proposal + user feedback
    const previousProposal = {
      summary: `Attempt ${iter + 1} edits`,
      edits: currentContract.edits,
    };
    const assistantContent = JSON.stringify(previousProposal, null, 2);

    messagesHistory.push({
      role: 'assistant',
      content: `\`\`\`json\n${assistantContent}\n\`\`\``,
    });

    messagesHistory.push({
      role: 'user',
      content: promptContent,
    });

    // 4. Rollback files to restore baseline before applying corrected edits
    const filesToRestore = Array.from(new Set(currentContract.edits.map((e) => e.path)));
    await rollbackFiles(currentContract.repo, filesToRestore);

    // 5. Generate a new proposal using the producer
    const nextDispatch: AgenticCodingEditProposalProducerDispatch = {
      ...dispatch,
      messages: messagesHistory as any,
    };

    let newProposal;
    try {
      newProposal = await generateEditProposal(nextDispatch, customClient);
    } catch (err) {
      // If the LLM call fails, return verification_failed
      return {
        status: 'verification_failed',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
      };
    }

    // 6. Apply the new proposal
    currentContract = {
      ...currentContract,
      edits: newProposal.edits,
    };

    try {
      const previews = await previewDeclaredEdits(currentContract);
      const failedPreviews = previews.filter((p) => p.status !== 'previewed');
      if (failedPreviews.length > 0) {
        // Return verification failed if preview of self-corrected proposal fails
        return {
          status: 'verification_failed',
          verification: currentVerification,
          iterations: iter + 1,
          contract: currentContract,
        };
      }

      await applyDeclaredEdits(currentContract);
    } catch {
      return {
        status: 'verification_failed',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
      };
    }

    // 7. Re-run verification commands
    currentVerification = await runVerificationCommands(
      currentContract,
      options.verificationTimeoutMs ?? 120000
    );

    hasFailed = currentVerification.some((result) => result.status !== 'passed');
    if (!hasFailed) {
      if (options.runId) {
        await saveCheckpoint({
          runId: options.runId,
          options,
          contract: currentContract,
          step: 'verified',
          timestamp: new Date().toISOString(),
          verification: currentVerification,
        });
      }
      return {
        status: 'verified',
        verification: currentVerification,
        iterations: iter + 1,
        contract: currentContract,
      };
    }
  }

  if (options.runId) {
    await saveCheckpoint({
      runId: options.runId,
      options,
      contract: currentContract,
      step: 'verified',
      timestamp: new Date().toISOString(),
      verification: currentVerification,
    });
  }

  return {
    status: 'verification_failed',
    verification: currentVerification,
    iterations: maxIterations,
    contract: currentContract,
  };
}
