/**
 * Pure helpers for skill marketplace galleries.
 *
 * @module renderer/utils/marketplace-catalog
 */

export interface SkillCard {
  id: string;
  name: string;
  category: string;
  description: string;
  installed?: boolean;
}

export function filterSkills(skills: SkillCard[], query: string, category: string): SkillCard[] {
  const normalizedQuery = query.trim().toLowerCase();
  return skills.filter((skill) => {
    const matchesCategory = !category || skill.category === category;
    const matchesQuery =
      !normalizedQuery ||
      skill.name.toLowerCase().includes(normalizedQuery) ||
      skill.description.toLowerCase().includes(normalizedQuery) ||
      skill.category.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });
}

export function groupByCategory(skills: SkillCard[]): Record<string, SkillCard[]> {
  return skills.reduce<Record<string, SkillCard[]>>((groups, skill) => {
    groups[skill.category] = groups[skill.category] ?? [];
    groups[skill.category].push(skill);
    return groups;
  }, {});
}
