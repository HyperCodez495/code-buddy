import { describe, expect, it } from 'vitest';

import { filterSkills, groupByCategory, type SkillCard } from '../src/renderer/utils/marketplace-catalog';

const skills: SkillCard[] = [
  { id: 'a', name: 'Hermes Mail', category: 'messaging', description: 'Gmail workflow' },
  { id: 'b', name: 'OpenClaw', category: 'agent', description: 'Remote worker' },
];

describe('filterSkills', () => {
  it('filters by text and category', () => {
    expect(filterSkills(skills, 'gmail', '').map((skill) => skill.id)).toEqual(['a']);
    expect(filterSkills(skills, '', 'agent').map((skill) => skill.id)).toEqual(['b']);
  });
});

describe('groupByCategory', () => {
  it('groups skills by category', () => {
    expect(Object.keys(groupByCategory(skills))).toEqual(['messaging', 'agent']);
  });
});
