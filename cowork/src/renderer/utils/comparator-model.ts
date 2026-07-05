/**
 * Pure helpers for model answer comparison.
 *
 * @module renderer/utils/comparator-model
 */

export interface ModelAnswer {
  id: string;
  model: string;
  answer: string;
  score: number;
  stance: 'agree' | 'disagree' | 'abstain';
}

export function rankAnswers(answers: ModelAnswer[]): ModelAnswer[] {
  return [...answers].sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
}

export function agreementRate(answers: ModelAnswer[]): number {
  const decisive = answers.filter((answer) => answer.stance !== 'abstain');
  if (decisive.length === 0) return 0;
  const agree = decisive.filter((answer) => answer.stance === 'agree').length;
  return agree / decisive.length;
}
